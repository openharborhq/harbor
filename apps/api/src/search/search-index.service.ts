import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@trustworthier/db";
import { InjectDb } from "../db/db.module";
import { MAX_INDEXED_CHARS } from "../processing/text-quality";
import { TS_CONFIGS } from "./search.service";

/**
 * Rebuilds `document_search` from what is in Postgres — title (A); tags, item labels, notes, the
 * category path and the model's search aliases (B); the OCR text and the summary (C).
 *
 * Two things make a bilingual vault searchable. The summary and `aliases` are the bridge across
 * languages: the household reads English and the paperwork is German, so neither the scan nor its
 * title contains the words they would type (spec §5). And every field is indexed under all three
 * text-search configs at once — `simple` keeps the words verbatim for numbers and names, `german`
 * and `english` add stems, so "bills" finds a "bill" and "Rechnungen" finds a "Rechnung".
 *
 * `terms` carries the same names as plain text for the trigram fallback in SearchService.
 */
@Injectable()
export class SearchIndexService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** No-op for an empty list. Safe to call inside a transaction by passing `tx`. */
  async reindex(documentIds: string[], tx: Pick<Db, "execute"> = this.db): Promise<void> {
    if (documentIds.length === 0) return;
    await tx.execute(sql`
      insert into document_search (document_id, tsv, terms, updated_at)
      select d.id,
             ${weighted(sql`d.title`, "A")}
          || ${weighted(sql`coalesce(b.words, '')`, "B")}
          || ${weighted(sql`left(coalesce(t.text_content, ''), ${MAX_INDEXED_CHARS})`, "C")}
          || ${weighted(sql`coalesce(sg.summary, '')`, "C")},
             d.title || ' ' || coalesce(b.words, ''),
             now()
      from documents d
      left join document_files df on df.document_id = d.id and df.is_current
      left join document_text t on t.document_file_id = df.id
      left join lateral (
        select payload->>'summary' as summary, payload from suggestions
        where document_file_id = df.id order by prompt_version desc, created_at desc limit 1
      ) sg on true
      left join lateral (
        select string_agg(w, ' ') as words
        from (
          select tg.name as w from document_tags dt join tags tg on tg.id = dt.tag_id where dt.document_id = d.id
          union all
          select i.label from document_items di join items i on i.id = di.item_id where di.document_id = d.id
          union all
          select d.notes where d.notes is not null
          union all
          select case when parent.name is null then cat.name else parent.name || ' ' || cat.name end
          from categories cat left join categories parent on parent.id = cat.parent_id
          where cat.id = d.category_id
          union all
          select jsonb_array_elements_text(coalesce(sg.payload->'aliases', '[]'::jsonb))
        ) x
      ) b on true
      where d.id in (${sql.join(documentIds.map((id) => sql`${id}::uuid`), sql`, `)})
      on conflict (document_id) do update set tsv = excluded.tsv, terms = excluded.terms, updated_at = now()
    `);
  }
}

/** One expression indexed under every config, all at the same weight. */
function weighted(expr: SQL, weight: "A" | "B" | "C"): SQL {
  return sql.join(
    TS_CONFIGS.map((cfg) => sql`setweight(to_tsvector(${cfg}, ${expr}), ${weight})`),
    sql` || `,
  );
}
