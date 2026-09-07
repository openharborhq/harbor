import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "@trustworthier/db";
import { InjectDb } from "../db/db.module";
import { MAX_INDEXED_CHARS } from "../processing/text-quality";
import { TS_CONFIG } from "./search.service";

/**
 * Rebuilds `document_search` rows from what is in Postgres — title (A), tags and item labels (B),
 * and the stored OCR text (C). The worker builds the same vector at the end of processing; this is
 * for everything that changes those inputs afterwards: retitling, refiling, and deleting an item
 * whose name would otherwise keep matching. Touches no blobs, so any container may call it.
 */
@Injectable()
export class SearchIndexService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** No-op for an empty list. Safe to call inside a transaction by passing `tx`. */
  async reindex(documentIds: string[], tx: Pick<Db, "execute"> = this.db): Promise<void> {
    if (documentIds.length === 0) return;
    await tx.execute(sql`
      insert into document_search (document_id, tsv, updated_at)
      select d.id,
             setweight(to_tsvector(${TS_CONFIG}, d.title), 'A')
          || setweight(to_tsvector(${TS_CONFIG}, coalesce(b.words, '')), 'B')
          || setweight(to_tsvector(${TS_CONFIG}, left(coalesce(t.text_content, ''), ${MAX_INDEXED_CHARS})), 'C'),
             now()
      from documents d
      left join lateral (
        select string_agg(w, ' ') as words
        from (
          select tg.name as w from document_tags dt join tags tg on tg.id = dt.tag_id where dt.document_id = d.id
          union all
          select i.label from document_items di join items i on i.id = di.item_id where di.document_id = d.id
        ) x
      ) b on true
      left join document_files df on df.document_id = d.id and df.is_current
      left join document_text t on t.document_file_id = df.id
      where d.id in (${sql.join(documentIds.map((id) => sql`${id}::uuid`), sql`, `)})
      on conflict (document_id) do update set tsv = excluded.tsv, updated_at = now()
    `);
  }
}
