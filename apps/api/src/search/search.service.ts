import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Db } from "@trustworthier/db";
import type { SearchHit, SearchQuery, SearchResponse } from "@trustworthier/shared";

import { InjectDb } from "../db/db.module";
import { CategoriesService } from "../vocabulary/categories.service";

/** Low enough to catch a dropped letter, high enough that unrelated documents stay out. */
const FUZZY_THRESHOLD = 0.6;

type Row = {
  document_id: string;
  title: string;
  category_id: string | null;
  document_date: string | null;
  source: "upload" | "email";
  rank: number;
  snippet: string | null;
  total: number;
} & Record<string, unknown>;


/**
 * Every document is indexed under all three at once, and every query is run against all three.
 * `simple` never stems, which is what invoice numbers, IBANs and names need; `german` and
 * `english` add stems, which is what "bills" and "Rechnungen" need. Indexing a few hundred family
 * documents three times over costs nothing worth measuring.
 */
export const TS_CONFIGS = ["simple", "german", "english"] as const;
/** The config for `ts_headline`: it highlights against the raw text, so it must not stem. */
export const TS_CONFIG = "simple";

@Injectable()
export class SearchService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly categories: CategoriesService,
  ) {}

  async search(q: SearchQuery): Promise<SearchResponse> {
    const started = Date.now();
    const exact = await this.byWords(q);
    if (exact.length > 0) return this.respond(exact, started, false);
    // Nothing matched the words themselves. Before giving up, try the spelling: "Stadwerke" is
    // one keystroke from a document the household certainly has.
    const close = await this.byLikeness(q);
    return this.respond(close, started, close.length > 0);
  }

  /** Full text, every config OR-ed: a query stemmed by any of them may match. */
  private byWords(q: SearchQuery) {
    const query = sql.join(
      TS_CONFIGS.map((cfg) => sql`websearch_to_tsquery(${cfg}, ${q.q})`),
      sql` || `,
    );
    return this.db.execute<Row>(sql`
      with q as (select ${query} as query)
      select d.id as document_id,
             d.title,
             d.category_id,
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
  }

  /**
   * Trigram fallback over `terms` — titles, tags, item labels, aliases. `word_similarity` scores
   * the best matching *word* inside the blob, so one misspelt word still finds the document
   * instead of being drowned out by everything else in it.
   */
  private byLikeness(q: SearchQuery) {
    return this.db.execute<Row>(sql`
      select d.id as document_id,
             d.title,
             d.category_id,
             d.document_date,
             d.source,
             word_similarity(${q.q}, s.terms) as rank,
             '' as snippet,
             count(*) over() as total
      from document_search s
      join documents d on d.id = s.document_id and d.deleted_at is null
      where word_similarity(${q.q}, s.terms) >= ${FUZZY_THRESHOLD}
      order by rank desc, d.created_at desc
      limit ${q.limit} offset ${q.offset}
    `);
  }

  private async respond(rows: Row[], started: number, fuzzy: boolean): Promise<SearchResponse> {
    const cats = await this.categories.index();
    const hits: SearchHit[] = rows.map((r) => ({
      documentId: r.document_id,
      title: r.title,
      categoryPath: r.category_id ? (cats.get(r.category_id)?.path ?? null) : null,
      documentDate: r.document_date,
      source: r.source,
      snippetHtml: r.snippet ?? "",
      rank: Number(r.rank),
    }));
    return { hits, total: rows.length ? Number(rows[0]!.total) : 0, tookMs: Date.now() - started, fuzzy };
  }
}
