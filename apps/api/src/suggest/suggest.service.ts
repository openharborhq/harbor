import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { categories, documentFiles, documentText, documents, people, suggestions, tags, type Db } from "@trustworthier/db";
import { SuggestionPayload, type SuggestionView } from "@trustworthier/shared";
import type { Env } from "../config/env";
import { InjectDb } from "../db/db.module";
import { CategoriesService } from "../vocabulary/categories.service";
import { AnthropicProvider } from "./anthropic.provider";
import { NoneProvider } from "./none.provider";
import { PROMPT_VERSION, TEXT_CHARS, type SuggestInput, type SuggestionProvider } from "./provider";

export const SUGGESTION_PROVIDER = Symbol("SUGGESTION_PROVIDER");

export function buildProvider(config: ConfigService<Env, true>): SuggestionProvider {
  const kind = config.get("SUGGEST_PROVIDER", { infer: true });
  if (kind === "none") return new NoneProvider();
  const keyFile = config.get("ANTHROPIC_API_KEY_FILE", { infer: true });
  const apiKey = keyFile ? readFileSync(keyFile, "utf8").trim() : (process.env.ANTHROPIC_API_KEY ?? "");
  if (!apiKey) throw new Error("SUGGEST_PROVIDER=anthropic but no key: set ANTHROPIC_API_KEY_FILE (Docker secret) or ANTHROPIC_API_KEY");
  return new AnthropicProvider(apiKey, config.get("SUGGEST_MODEL", { infer: true }));
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

    const [cats, folks, tagRows] = await Promise.all([
      this.categoriesService.index(),
      this.db.select({ displayName: people.displayName }).from(people),
      this.db.select({ name: tags.name }).from(tags),
    ]);
    const input: SuggestInput = {
      filename: row.df.originalFilename,
      source: row.doc.source,
      senderAddress: null, // email-in arrives in M3
      pageCount: row.df.pageCount,
      text: (row.text ?? "").slice(0, TEXT_CHARS),
      categories: [...cats.values()].map((c) => ({ slug: c.cat.slug, path: c.path })),
      peopleFirstNames: this.sendPeople ? folks.map((p) => firstName(p.displayName)) : [],
      tags: tagRows.map((t) => t.name),
      readerLanguage: this.readerLanguage,
    };

    const out = await this.provider.suggest(input);
    if (!out) {
      this.log.log(`${documentFileId}: no suggestion (${this.provider.name})`);
      return null;
    }
    const payload = SuggestionPayload.parse(out.payload);
    const [stored] = await this.db
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
        target: [suggestions.documentFileId, suggestions.model, suggestions.promptVersion],
        set: { payload, textChars: input.text.length, inputTokens: out.inputTokens, outputTokens: out.outputTokens, createdAt: new Date(), acceptedAt: null, rejectedAt: null },
      })
      .returning({ id: suggestions.id });
    this.log.log(`${documentFileId}: ${this.provider.name}/${out.model} · ${payload.confidence} · ${out.inputTokens ?? "?"} in / ${out.outputTokens ?? "?"} out`);
    return stored!.id;
  }

  /** Latest suggestion per file, resolved against the current vocabulary. */
  async latestForFiles(fileIds: string[]): Promise<Map<string, SuggestionView>> {
    if (fileIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(suggestions)
      .where(inArray(suggestions.documentFileId, fileIds))
      .orderBy(desc(suggestions.createdAt));
    const [cats, folks] = await Promise.all([this.categoriesService.index(), this.db.select({ id: people.id, displayName: people.displayName }).from(people)]);
    const bySlug = new Map([...cats.values()].map((c) => [c.cat.slug, c]));
    const out = new Map<string, SuggestionView>();
    for (const s of rows) {
      if (out.has(s.documentFileId)) continue;
      const parsed = SuggestionPayload.safeParse(s.payload);
      if (!parsed.success) continue;
      const cat = parsed.data.categorySlug ? bySlug.get(parsed.data.categorySlug) : undefined;
      const wanted = new Set(parsed.data.personNames.map((n) => n.toLowerCase()));
      const personIds = folks.filter((p) => wanted.has(firstName(p.displayName).toLowerCase()) || wanted.has(p.displayName.toLowerCase())).map((p) => p.id);
      out.set(s.documentFileId, {
        id: s.id,
        provider: s.provider,
        model: s.model,
        payload: parsed.data,
        resolved: { categoryId: cat?.cat.id ?? null, categoryPath: cat?.path ?? null, personIds },
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
