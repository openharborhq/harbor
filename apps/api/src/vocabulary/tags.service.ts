import { Injectable } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { documentTags, tags, type Db } from "@harbor/db";
import { slugify } from "@harbor/shared";
import { InjectDb } from "../db/db.module";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

@Injectable()
export class TagsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Upsert by slug and return ids in input order. Names are user vocabulary; slugs dedupe case/spacing. */
  async ensure(names: string[], tx: Tx | Db = this.db): Promise<string[]> {
    const wanted = [...new Map(names.map((n) => [slugify(n), n.trim()])).entries()].filter(([slug]) => slug);
    if (wanted.length === 0) return [];
    const rows = await tx
      .insert(tags)
      .values(wanted.map(([slug, name]) => ({ slug, name })))
      .onConflictDoUpdate({ target: tags.slug, set: { name: sql`excluded.name` } })
      .returning({ id: tags.id, slug: tags.slug });
    const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
    return wanted.map(([slug]) => bySlug.get(slug)!).filter(Boolean);
  }

  async setForDocument(documentId: string, names: string[], tx: Tx | Db = this.db): Promise<void> {
    const ids = await this.ensure(names, tx);
    await tx.delete(documentTags).where(eq(documentTags.documentId, documentId));
    if (ids.length) await tx.insert(documentTags).values(ids.map((tagId) => ({ documentId, tagId })));
  }

  async namesForDocuments(documentIds: string[]): Promise<Map<string, string[]>> {
    if (documentIds.length === 0) return new Map();
    const rows = await this.db
      .select({ documentId: documentTags.documentId, name: tags.name })
      .from(documentTags)
      .innerJoin(tags, eq(tags.id, documentTags.tagId))
      .where(inArray(documentTags.documentId, documentIds));
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.documentId, [...(out.get(r.documentId) ?? []), r.name]);
    return out;
  }
}
