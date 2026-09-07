import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { categories, documentFiles, documentText, documents, suggestions, tags, type Db } from "@harbor/db";
import { SuggestionPayload, type SuggestionView } from "@harbor/shared";
import type { Env } from "../config/env";
import { InjectDb } from "../db/db.module";
import { SearchIndexService } from "../search/search-index.service";
import { CategoriesService } from "../vocabulary/categories.service";
import { ItemsService } from "../vocabulary/items.service";
import { AnthropicProvider } from "./anthropic.provider";
import { NoneProvider } from "./none.provider";
import { OpenAiCompatibleProvider } from "./openai-compatible.provider";
import { PROMPT_VERSION, TEXT_CHARS, type SuggestInput, type SuggestionProvider } from "./provider";

export const SUGGESTION_PROVIDER = Symbol("SUGGESTION_PROVIDER");

export function buildProvider(config: ConfigService<Env, true>): SuggestionProvider {
  const kind = config.get("SUGGEST_PROVIDER", { infer: true });
  const model = config.get("SUGGEST_MODEL", { infer: true });
  if (kind === "none") return new NoneProvider();

  if (kind === "openai-compatible") {
    const baseUrl = config.get("SUGGEST_BASE_URL", { infer: true });
    if (!baseUrl) throw new Error("SUGGEST_PROVIDER=openai-compatible but no SUGGEST_BASE_URL (e.g. http://ollama:11434/v1)");
    // Optional on purpose: a model served on the LAN has nothing to authenticate.
    const apiKey = readKey(config.get("SUGGEST_API_KEY_FILE", { infer: true }), "SUGGEST_API_KEY");
    return new OpenAiCompatibleProvider(baseUrl, apiKey, model);
  }

  const apiKey = readKey(config.get("ANTHROPIC_API_KEY_FILE", { infer: true }), "ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("SUGGEST_PROVIDER=anthropic but no key: set ANTHROPIC_API_KEY_FILE (Docker secret) or ANTHROPIC_API_KEY");
  return new AnthropicProvider(apiKey, model);
}

/** Docker secret first, environment second (spec §3.7: keys are secrets, not env vars, in production). */
function readKey(file: string | undefined, envVar: string): string | null {
  const key = file ? readFileSync(file, "utf8").trim() : (process.env[envVar] ?? "").trim();
  return key || null;
}

@Injectable()
export class SuggestService {
  private readonly log = new Logger(SuggestService.name);
  private readonly sendPeople: boolean;
  private readonly readerLanguage: string;

  constructor(
    @InjectDb() private readonly db: Db,
    @Inject(SUGGESTION_PROVIDER) private readonly provider: SuggestionProvider,
    private readonly categoriesService: CategoriesService,
    private readonly itemsService: ItemsService,
    private readonly searchIndex: SearchIndexService,
    config: ConfigService<Env, true>,
  ) {
    this.sendPeople = config.get("SUGGEST_SEND_PEOPLE", { infer: true });
    this.readerLanguage = config.get("SUGGEST_READER_LANGUAGE", { infer: true });
  }

  /** Stage 4 (spec §2, §5). Returns the stored suggestion id, or null when the provider had nothing to say. */
  async suggestForFile(documentFileId: string): Promise<string | null> {
    const row = await this.db
      .select({ df: documentFiles, doc: documents, text: documentText.textContent })
      .from(documentFiles)
      .innerJoin(documents, eq(documents.id, documentFiles.documentId))
      .leftJoin(documentText, eq(documentText.documentFileId, documentFiles.id))
      .where(eq(documentFiles.id, documentFileId))
      .limit(1)
      .then((r) => r[0]);
    if (!row) throw new Error(`document_files ${documentFileId} not found`);

    const [cats, allItems, tagRows] = await Promise.all([
      this.categoriesService.index(),
      this.itemsService.list(),
      this.db.select({ name: tags.name }).from(tags),
    ]);
    const input: SuggestInput = {
      filename: row.df.originalFilename,
      source: row.doc.source,
      senderAddress: null, // email-in arrives in M3
      pageCount: row.df.pageCount,
      text: (row.text ?? "").slice(0, TEXT_CHARS),
      categories: [...cats.values()].map((c) => ({ slug: c.cat.slug, path: c.path })),
      items: this.sendPeople ? allItems.map((i) => ({ label: i.label, kind: i.kind, parentLabel: i.parentLabel })) : [],
      tags: tagRows.map((t) => t.name),
      readerLanguage: this.readerLanguage,
    };

    const out = await this.provider.suggest(input);
    if (!out) {
      this.log.log(`${documentFileId}: no suggestion (${this.provider.name})`);
      await this.markReady(documentFileId);
      return null;
    }
    const payload = SuggestionPayload.parse(out.payload);
    // Storing the suggestion and leaving "suggesting" are one write: killing the suggester between
    // the two used to strand the file in "suggesting" forever with its suggestion already saved.
    const stored = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(suggestions)
        .values({
          documentId: row.doc.id,
          documentFileId,
          provider: this.provider.name,
          model: out.model,
          promptVersion: PROMPT_VERSION,
          payload,
          textChars: input.text.length,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
        })
        .onConflictDoUpdate({
          target: [suggestions.documentFileId, suggestions.provider, suggestions.model, suggestions.promptVersion],
          set: { payload, textChars: input.text.length, inputTokens: out.inputTokens, outputTokens: out.outputTokens, createdAt: new Date(), acceptedAt: null, rejectedAt: null },
        })
        .returning({ id: suggestions.id });
      await tx.update(documentFiles).set({ processingStatus: "ready" }).where(eq(documentFiles.id, documentFileId));
      // The worker built the vector before this summary existed; it is the document's only
      // English description when the paperwork itself is German (spec §5).
      await this.searchIndex.reindex([row.doc.id], tx);
      return inserted!.id;
    });
    this.log.log(`${documentFileId}: ${this.provider.name}/${out.model} · ${payload.confidence} · ${out.inputTokens ?? "?"} in / ${out.outputTokens ?? "?"} out`);
    return stored;
  }

  /** Suggestions are best-effort: the document is complete without one, so it must never stay "suggesting". */
  async markReady(documentFileId: string): Promise<void> {
    await this.db.update(documentFiles).set({ processingStatus: "ready" }).where(eq(documentFiles.id, documentFileId));
  }

  /** Latest suggestion per file, resolved against the current vocabulary. */
  async latestForFiles(fileIds: string[]): Promise<Map<string, SuggestionView>> {
    if (fileIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(suggestions)
      .where(inArray(suggestions.documentFileId, fileIds))
      .orderBy(desc(suggestions.createdAt));
    const [cats, allItems] = await Promise.all([this.categoriesService.index(), this.itemsService.list()]);
    const bySlug = new Map([...cats.values()].map((c) => [c.cat.slug, c]));
    const out = new Map<string, SuggestionView>();
    for (const s of rows) {
      if (out.has(s.documentFileId)) continue;
      const parsed = SuggestionPayload.safeParse(s.payload);
      if (!parsed.success) continue;
      const cat = parsed.data.categorySlug ? bySlug.get(parsed.data.categorySlug) : undefined;
      const wanted = new Set(parsed.data.itemLabels.map((n: string) => n.trim().toLowerCase()));
      const matched = allItems.filter((i) => wanted.has(i.label.toLowerCase()) || wanted.has(firstName(i.label).toLowerCase()));
      // Naming a child implies its parent: a boiler invoice is also about the house (spec §6).
      const itemIds = [...new Set(matched.flatMap((i) => (i.parentId ? [i.id, i.parentId] : [i.id])))];
      out.set(s.documentFileId, {
        id: s.id,
        provider: s.provider,
        model: s.model,
        payload: parsed.data,
        resolved: { categoryId: cat?.cat.id ?? null, categoryPath: cat?.path ?? null, itemIds },
        createdAt: s.createdAt.toISOString(),
        acceptedAt: s.acceptedAt?.toISOString() ?? null,
        rejectedAt: s.rejectedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  async markAccepted(id: string): Promise<void> {
    await this.db.update(suggestions).set({ acceptedAt: new Date(), rejectedAt: null }).where(eq(suggestions.id, id));
  }
  async markRejected(id: string): Promise<void> {
    await this.db.update(suggestions).set({ rejectedAt: new Date(), acceptedAt: null }).where(eq(suggestions.id, id));
  }
}

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

export { categories };
