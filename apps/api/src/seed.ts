import "reflect-metadata";
import { rm, writeFile } from "node:fs/promises";
import { NestFactory } from "@nestjs/core";
import { sql } from "drizzle-orm";
import { closeDb, createDb, documents, items, runMigrations, users, type Db } from "@harbor/db";
import { AppModule } from "./app.module";
import { DB } from "./db/db.module";
import { DocumentsService } from "./documents/documents.service";
import { BlobStore } from "./storage/blob-store.service";
import { CategoriesService } from "./vocabulary/categories.service";
import { ItemsService } from "./vocabulary/items.service";

/**
 * Demo records for a vault someone is looking at rather than living in.
 *
 *   node dist/seed.js            refuses if the vault already holds anything
 *   node dist/seed.js --force    seed anyway (adds to what is there)
 *
 * Everything here is invented — the Muster household, Musterstadt's suppliers, invoice numbers
 * that belong to nobody. Never seed from a real vault: this file is public, and a demo is not
 * worth handing over a household's paperwork.
 *
 * The documents are real PDFs put through the ordinary upload path, not rows pushed into the
 * database, so the demo exercises what the vault actually does: extraction, indexing, search,
 * and a suggestion for the ones left unfiled. That means the worker has to be running, or they
 * will sit at "queued" until it is.
 */

interface Doc {
  filename: string;
  lines: string[];
  /** Where it is filed. Omitted means it lands in the Inbox, waiting for a decision. */
  categorySlug?: string;
  items?: string[];
  tags?: string[];
  documentDate?: string;
  /** Some are deliberately within the 90-day horizon, so Home's *Expiring soon* is not empty. */
  expiresAt?: string;
}

const PEOPLE = [
  { label: "Anna Muster", details: { relationship: "self", dateOfBirth: "1986-04-12" } },
  { label: "Mara Muster", details: { relationship: "daughter", dateOfBirth: "2016-09-02" } },
  { label: "Jonas Muster", details: { relationship: "son", dateOfBirth: "2019-01-24" } },
];

/** Dates are relative to the run, so a seeded demo is never stale. */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function documentSet(): Doc[] {
  return [
    {
      filename: "Stromrechnung-R-2026-0147.pdf",
      categorySlug: "real-estate/utilities",
      items: ["Musterstraße 7"],
      tags: ["bill"],
      documentDate: inDays(-21),
      lines: [
        "Stadtwerke Musterstadt GmbH",
        "Musterstadt · Kundennummer 55 210 884",
        "",
        "STROMRECHNUNG",
        "Rechnungsnummer R-2026-0147",
        `Abrechnungszeitraum: ${inDays(-51)} bis ${inDays(-21)}`,
        "Lieferstelle: Musterstraße 7, 80331 Musterstadt",
        "",
        "Verbrauch 312 kWh à 0,241 EUR ............ 75,19 EUR",
        "Grundpreis ............................... 9,01 EUR",
        "Rechnungsbetrag .......................... 84,20 EUR",
        "",
        `Fällig am ${inDays(9)}. Der Betrag wird per SEPA-Lastschrift eingezogen.`,
      ],
    },
    {
      filename: "Hausratversicherung-Police.pdf",
      categorySlug: "insurance/home",
      items: ["Musterstraße 7"],
      tags: ["policy"],
      documentDate: inDays(-300),
      expiresAt: inDays(65),
      lines: [
        "Allsicher Versicherung AG",
        "",
        "HAUSRATVERSICHERUNG — VERSICHERUNGSSCHEIN",
        "Policennummer HR-88-402-119",
        "Versicherungsnehmerin: Anna Muster",
        "Versichertes Objekt: Musterstraße 7, 80331 Musterstadt",
        "",
        "Versicherungssumme .................. 85.000 EUR",
        "Selbstbeteiligung ....................... 150 EUR",
        "Jahresbeitrag ........................... 214,80 EUR",
        "",
        `Vertragslaufzeit bis ${inDays(65)}. Verlängert sich um ein Jahr, wenn nicht drei Monate vorher gekündigt.`,
      ],
    },
    {
      filename: "Reisepass-Anna-Muster.pdf",
      categorySlug: "identity/passports",
      items: ["Anna Muster"],
      documentDate: inDays(-1400),
      expiresAt: inDays(48),
      lines: [
        "BUNDESREPUBLIK MUSTERLAND",
        "",
        "REISEPASS — Abholbestätigung",
        "Pass-Nr. C4H7K2M9P",
        "Name: MUSTER, ANNA",
        "Geburtsdatum: 12.04.1986",
        `Ausgestellt: ${inDays(-1400)}`,
        `Gültig bis: ${inDays(48)}`,
        "",
        "Bitte beachten Sie: viele Länder verlangen eine Restgültigkeit von sechs Monaten.",
      ],
    },
    {
      filename: "Kfz-Versicherung-Beitragsrechnung.pdf",
      categorySlug: "insurance/auto",
      items: ["VW Golf (M-AB 1234)"],
      tags: ["bill"],
      documentDate: inDays(-40),
      lines: [
        "Nordwind Versicherung",
        "",
        "KFZ-VERSICHERUNG — BEITRAGSRECHNUNG",
        "Vertragsnummer KFZ-2026-77310",
        "Fahrzeug: VW Golf, amtliches Kennzeichen M-AB 1234",
        "Halterin: Anna Muster",
        "",
        "Haftpflicht + Teilkasko, SF-Klasse 18",
        "Jahresbeitrag ........................... 398,00 EUR",
        `Fällig am ${inDays(20)}`,
      ],
    },
    {
      filename: "Zeugnis-Mara.pdf",
      categorySlug: "education/report-cards",
      items: ["Mara Muster"],
      documentDate: inDays(-95),
      lines: [
        "Grundschule Musterstadt-West",
        "",
        "JAHRESZEUGNIS",
        `Schuljahr ${new Date().getFullYear() - 1}/${new Date().getFullYear()}`,
        "Schülerin: Mara Muster, Klasse 3b",
        "",
        "Deutsch ......................... gut",
        "Mathematik ...................... sehr gut",
        "Sachunterricht .................. gut",
        "Musik ........................... befriedigend",
        "",
        "Mara arbeitet konzentriert und hilft anderen Kindern gern.",
      ],
    },
    {
      filename: "Impfbescheinigung-Mara.pdf",
      categorySlug: "health/immunizations",
      items: ["Mara Muster"],
      documentDate: inDays(-130),
      lines: [
        "Kinderarztpraxis Dr. Berg",
        "Musterstadt",
        "",
        "IMPFBESCHEINIGUNG",
        "Patientin: Mara Muster, geboren 02.09.2016",
        "",
        `${inDays(-130)}  Auffrischung Tetanus/Diphtherie/Polio`,
        "Chargennummer 4471-B",
        "",
        "Nächste Auffrischung in zehn Jahren empfohlen.",
      ],
    },
    // Two arrive unfiled on purpose: an empty Inbox shows none of what the vault is for. The vet
    // invoice has no obvious home in the built-in vocabulary, which is exactly the case the Inbox
    // and the "new category" hint exist for.
    {
      filename: "Tierarztrechnung-Nala.pdf",
      items: ["Nala"],
      tags: ["bill"],
      documentDate: inDays(-12),
      lines: [
        "Tierarztpraxis am Stadtpark",
        "",
        "RECHNUNG INV-2026-00417",
        "Patient: Nala (Hündin, Mischling, 4 Jahre)",
        "Halterin: Anna Muster",
        "",
        "Jahresuntersuchung ....................... 42,00 EUR",
        "Tollwut-Auffrischung ..................... 31,50 EUR",
        "Gesamt ................................... 73,50 EUR",
        "",
        `Zahlbar bis ${inDays(18)}.`,
      ],
    },
    {
      filename: "Kontoauszug-Maerz.pdf",
      categorySlug: "money/statements",
      items: ["Nordbank Girokonto"],
      documentDate: inDays(-8),
      lines: [
        "Nordbank Musterstadt",
        "",
        "KONTOAUSZUG Nr. 3",
        "Kontoinhaberin: Anna Muster",
        "IBAN ML00 4400 1234 5678 9012 00",
        "",
        `${inDays(-30)}  Gehalt ........................ +2.910,44 EUR`,
        `${inDays(-27)}  Miete Musterstraße 7 .......... -1.180,00 EUR`,
        `${inDays(-21)}  Stadtwerke Musterstadt ........... -84,20 EUR`,
        "",
        "Neuer Saldo .............................. 3.412,88 EUR",
      ],
    },
    {
      filename: "Handwerker-Angebot-Heizung.pdf",
      documentDate: inDays(-3),
      lines: [
        "Heizungsbau Kessler & Sohn",
        "",
        "ANGEBOT A-2026-2280",
        "Objekt: Musterstraße 7, 80331 Musterstadt",
        "",
        "Austausch Umwälzpumpe inkl. Material ..... 640,00 EUR",
        "Hydraulischer Abgleich ................... 380,00 EUR",
        "Zwischensumme .......................... 1.020,00 EUR",
        "zzgl. 19% MwSt ........................... 193,80 EUR",
        "Gesamt ................................. 1.213,80 EUR",
        "",
        "Das Angebot ist 30 Tage gültig.",
      ],
    },
  ];
}

/**
 * A one-page PDF with selectable text — no dependency, and small enough to read.
 *
 * Text, not a scan, on purpose: the seed should populate a demo in seconds on any machine, and
 * OCR of nine rendered pages is a minute of CPU that proves nothing the real pipeline has not
 * already proved. The extraction path they take is the same one a text PDF from a real biller takes.
 */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Latin-1 is what the base-14 fonts encode; ä/ö/ü/ß survive, anything else is not worth a font.
  const content = `BT\n/F1 11 Tf\n50 780 Td\n15 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join("\n")}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function main() {
  const force = process.argv.includes("--force");
  await migrateFirst(process.env.DATABASE_URL ?? "");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const db = app.get<Db>(DB);
    const documentsService = app.get(DocumentsService);
    const itemsService = app.get(ItemsService);
    const categories = app.get(CategoriesService);
    const blobs = app.get(BlobStore);

    const [owner] = await db.select({ id: users.id, email: users.email }).from(users).limit(1);
    if (!owner) fail("No owner yet — create one first (open the app, or run `node dist/setup.js`).");

    const [counts] = await db
      .select({ docs: sql<number>`(select count(*)::int from ${documents})`, items: sql<number>`(select count(*)::int from ${items})` })
      .from(sql`(select 1) as one`);
    if (!force && ((counts?.docs ?? 0) > 0 || (counts?.items ?? 0) > 0)) {
      fail(`This vault already holds ${counts?.docs ?? 0} document(s) and ${counts?.items ?? 0} item(s). Seeding is for an empty demo vault; pass --force if you meant it.`);
    }

    // People first, then the things, so a boiler can hang off the house that owns it.
    const byLabel = new Map<string, string>();
    for (const p of PEOPLE) {
      const item = await itemsService.create({ kind: "person", label: p.label, details: p.details }, owner.id);
      byLabel.set(p.label, item.id);
    }
    const house = await itemsService.create(
      { kind: "property", label: "Musterstraße 7", details: { address: "Musterstraße 7, 80331 Musterstadt", role: "rented" } },
      owner.id,
    );
    byLabel.set("Musterstraße 7", house.id);
    for (const thing of [
      { kind: "vehicle" as const, label: "VW Golf (M-AB 1234)", details: { plate: "M-AB 1234", firstRegistered: "2019-06-01" } },
      { kind: "pet" as const, label: "Nala", details: { species: "dog", dateOfBirth: "2022-03-18" } },
      { kind: "account" as const, label: "Nordbank Girokonto", details: { institution: "Nordbank Musterstadt" } },
    ]) {
      const item = await itemsService.create(thing, owner.id);
      byLabel.set(thing.label, item.id);
    }
    // The boiler belongs to the house: naming it on an invoice implies the property too (spec §6).
    await itemsService.create({ kind: "other", label: "Gasheizung", parentId: house.id, details: { installed: "2014" } }, owner.id);

    const cats = await categories.index();
    const bySlug = new Map([...cats.values()].map((c) => [c.cat.slug, c.cat.id]));

    let filed = 0;
    let inbox = 0;
    for (const doc of documentSet()) {
      const temp = blobs.newTempPath(".pdf");
      try {
        const bytes = makePdf(doc.lines);
        await writeFile(temp, bytes, { mode: 0o600 });
        const categoryId = doc.categorySlug ? bySlug.get(doc.categorySlug) : undefined;
        if (doc.categorySlug && !categoryId) console.warn(`  (no category "${doc.categorySlug}" in this vault — filing to the Inbox instead)`);
        const result = await documentsService.ingest(
          { path: temp, originalName: doc.filename, byteSize: bytes.length },
          { categoryId, itemIds: (doc.items ?? []).map((l) => byLabel.get(l)).filter((id): id is string => Boolean(id)), tags: doc.tags ?? [] },
          { userId: owner.id, source: "upload" },
        );
        if (doc.documentDate || doc.expiresAt) {
          await documentsService.update(result.document.id, { documentDate: doc.documentDate ?? null, expiresAt: doc.expiresAt ?? null }, owner.id, null);
        }
        if (categoryId) filed++;
        else inbox++;
        console.log(`  ${doc.filename}${categoryId ? ` → ${cats.get(categoryId)?.path}` : " → Inbox"}`);
      } finally {
        await rm(temp, { force: true });
      }
    }

    console.log(`\nSeeded ${filed + inbox} documents (${filed} filed, ${inbox} left in the Inbox) and ${byLabel.size + 1} items for ${owner.email}.`);
    console.log("They are queued for text extraction — start the worker (`pnpm dev:all`, or the worker container) if they stay at “queued”.");
    console.log("All of it is invented. Delete the vault's data directory to start over.");
  } finally {
    await app.close();
  }
}

function fail(msg: string): never {
  console.error(`seed: ${msg}`);
  process.exit(1);
}

/** As in the other entrypoints: migrate on a throwaway connection before module init runs. */
async function migrateFirst(url: string) {
  const db = createDb(url);
  try {
    await runMigrations(db);
  } finally {
    await closeDb(db);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

export { makePdf, documentSet };
