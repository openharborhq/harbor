import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "@trustworthier/db";
import type { SearchHit, SearchQuery, SearchResponse } from "@trustworthier/shared";
import { InjectDb } from "../db/db.module";

/** Text search config. 'simple' = no stemming, so mixed German/English documents behave predictably. */
export const TS_CONFIG = "simple";

@Injectable()
export class SearchService {
  constructor(@InjectDb() private readonly db: Db) {}

  async search(q: SearchQuery): Promise<SearchResponse> {
    const started = Date.now();
    const rows = await this.db.execute<{
      document_id: string;
      title: string;
      document_date: string | null;
      source: "upload" | "email";
      rank: number;
      snippet: string | null;
      total: number;
    }>(sql`
      with q as (select websearch_to_tsquery(${TS_CONFIG}, ${q.q}) as query)
      select d.id as document_id,
             d.title,
             d.document_date,
             d.source,
             ts_rank_cd(s.tsv, q.query) as rank,
             ts_headline(${TS_CONFIG}, coalesce(t.text_content, ''), q.query,
               'MaxFragments=2, MaxWords=18, MinWords=6, StartSel=<mark>, StopSel=</mark>, FragmentDelimiter= ... ') as snippet,
             count(*) over() as total
      from document_search s
      cross join q
      join documents d on d.id = s.document_id and d.deleted_at is null
      join document_files f on f.document_id = d.id and f.is_current
      left join document_text t on t.document_file_id = f.id
      where s.tsv @@ q.query
      order by rank desc, d.created_at desc
      limit ${q.limit} offset ${q.offset}
    `);

    const hits: SearchHit[] = rows.map((r) => ({
      documentId: r.document_id,
      title: r.title,
      categoryPath: null, // categories arrive in M4
      documentDate: r.document_date,
      source: r.source,
      snippetHtml: r.snippet ?? "",
      rank: Number(r.rank),
    }));
    return { hits, total: rows.length ? Number(rows[0]!.total) : 0, tookMs: Date.now() - started };
  }
}
