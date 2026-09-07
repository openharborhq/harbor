"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActivityEntry, Category, DocumentSummary, DocumentText, DocumentVersion, Item } from "@trustworthier/shared";
import { ItemPicker } from "./ItemPicker";
import { api } from "@/lib/api-client";
import { formatBytes, formatDate, formatRelative, pages } from "@/lib/format";
import { StatusPill } from "./StatusPill";

type Tab = "details" | "text" | "versions" | "activity";

/** The right-hand panel of the Document Detail design: four tabs, an edit mode, and delete. */
export function DocumentDetail({
  doc,
  text,
  versions,
  activity,
  categories,
  items,
}: {
  doc: DocumentSummary;
  text: DocumentText;
  versions: DocumentVersion[];
  activity: ActivityEntry[];
  categories: Category[];
  items: Item[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = doc.suggestion;

  async function remove() {
    setBusy(true);
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      router.push(doc.category ? "/library" : "/inbox");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-[420px] min-w-[360px] flex-col">
      <div className="flex gap-5 border-b border-border">
        {(["details", "text", "versions", "activity"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px whitespace-nowrap border-b-2 pb-3 text-row font-medium ${tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"}`}
          >
            {t === "details" ? "Details" : t === "text" ? "Extracted text" : t === "versions" ? "Versions" : "Activity"}
          </button>
        ))}
      </div>

      {tab === "details" && !editing && (
        <div className="flex flex-1 flex-col">
          {s?.payload.summary ? (
            <div className="mt-6 rounded-lg bg-surface px-4 py-3.5">
              <div className="label">Summary</div>
              <p className="mt-1.5 text-body">{s.payload.summary}</p>
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-surface px-4 py-3.5 text-small text-muted">No summary for this document.</div>
          )}
          <dl className="mt-3 divide-y divide-border text-row">
            <Row k="Category" v={doc.category ? doc.category.path : "Inbox — not filed yet"} />
            <Row k="For" v={doc.items.length ? doc.items.map((p) => p.label).join(", ") : "—"} />
            <Row k="Document date" v={formatDate(doc.documentDate)} />
            <Row k="Expires" v={formatDate(doc.expiresAt)} />
            <Row k="Added" v={`${formatDate(doc.createdAt)} · ${doc.source === "email" ? "email" : "upload"}`} />
            <Row k="File" v={`${doc.file.originalFilename} · ${pages(doc.file.pageCount) || "—"} · ${formatBytes(doc.file.byteSize)}${doc.file.version > 1 ? ` · version ${doc.file.version}` : ""}`} />
            <div className="flex gap-4 py-3">
              <dt className="w-32 shrink-0 text-muted">Tags</dt>
              <dd className="flex flex-wrap gap-1.5">
                {doc.tags.map((t) => (
                  <span key={t} className="rounded-sm bg-surface px-2 py-0.5 text-small font-medium">
                    {t}
                  </span>
                ))}
                {doc.tags.length === 0 && <span className="text-muted">—</span>}
              </dd>
            </div>
            {doc.notes && <Row k="Notes" v={doc.notes} />}
          </dl>
          <div className="mt-auto flex items-center justify-between pt-8">
            {confirmDelete ? (
              <div className="flex items-center gap-3 text-row">
                <span className="text-muted">Move to Recently deleted?</span>
                <button type="button" onClick={remove} disabled={busy} className="font-semibold text-danger">
                  {busy ? "Deleting…" : "Yes, delete"}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="font-medium text-muted">
                  Keep
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-row font-medium text-danger">
                Delete document
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)} className="h-10 rounded-md bg-accent px-4 text-row font-semibold text-white">
              Edit details
            </button>
          </div>
          {error && <p className="mt-2 text-small text-danger">{error}</p>}
        </div>
      )}

      {tab === "details" && editing && <EditForm doc={doc} categories={categories} items={items} onDone={() => setEditing(false)} />}

      {tab === "text" && (
        <div className="mt-6 flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-3 text-small text-muted">
            <StatusPill status={doc.file.processingStatus} />
            {text.engine ? `${text.engine === "ocrmypdf" ? "OCR" : "Text layer"} · ${text.chars.toLocaleString()} characters` : "No text extracted"}
          </div>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-4 font-sans text-small leading-[18px]">{text.text || "Nothing readable was found on the pages."}</pre>
        </div>
      )}

      {tab === "versions" && (
        <ul className="mt-6 flex flex-col divide-y divide-border">
          {versions.map((v) => (
            <li key={v.fileId} className="flex items-center gap-4 py-3.5 text-row">
              <span className={`inline-flex h-[22px] items-center rounded-pill px-2.5 text-label font-semibold ${v.isCurrent ? "bg-accent-soft text-accent" : "bg-surface text-muted"}`}>v{v.version}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{v.originalFilename}</div>
                <div className="text-small text-muted">
                  {formatDate(v.createdAt)}
                  {v.uploadedBy ? ` by ${v.uploadedBy}` : ""} · {pages(v.pageCount) || "—"} · {formatBytes(v.byteSize)}
                </div>
              </div>
              <a href={`/api/documents/${doc.id}/file?version=${v.version}`} className="text-row font-medium text-accent">
                Open
              </a>
            </li>
          ))}
        </ul>
      )}

      {tab === "activity" && (
        <ul className="mt-6 flex flex-col divide-y divide-border">
          {activity.map((a) => (
            <li key={a.id} className="flex items-baseline gap-4 py-3 text-row">
              <span className="w-32 shrink-0 text-small text-muted">{formatRelative(a.createdAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{a.actor ?? "System"}</span> <span className="text-muted">{describe(a)}</span>
              </span>
            </li>
          ))}
          {activity.length === 0 && <li className="py-3 text-row text-muted">No activity recorded.</li>}
        </ul>
      )}
      <p className="mt-6 text-small text-muted">
        <Link href="/library/deleted" className="font-medium text-accent">
          Recently deleted
        </Link>
      </p>
    </aside>
  );
}

function EditForm({ doc, categories, items, onDone }: { doc: DocumentSummary; categories: Category[]; items: Item[]; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(doc.title);
  const [categoryId, setCategoryId] = useState(doc.category?.id ?? "");
  const [itemIds, setItemIds] = useState(doc.items.map((p) => p.id));
  const [documentDate, setDocumentDate] = useState(doc.documentDate ?? "");
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt ?? "");
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          categoryId: categoryId || null,
          itemIds,
          documentDate: documentDate || null,
          expiresAt: expiresAt || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          notes: notes || null,
        }),
      });
      onDone();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const tops = categories.filter((c) => c.parentId === null);
  return (
    <form onSubmit={save} className="mt-6 flex flex-col gap-4">
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} required className="h-10 w-full rounded-md border border-border-strong px-3 text-row" />
      </Field>
      <Field label="Category">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10 w-full rounded-md border border-border-strong bg-ground px-3 text-row">
          <option value="">Inbox — not filed</option>
          {tops.map((t) => (
            <optgroup key={t.id} label={t.name}>
              <option value={t.id}>{t.name}</option>
              {categories
                .filter((c) => c.parentId === t.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {t.name} › {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <ItemPicker items={items} selected={itemIds} onChange={setItemIds} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Document date">
          <input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className="h-10 w-full rounded-md border border-border-strong px-3 text-row" />
        </Field>
        <Field label="Expires">
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-10 w-full rounded-md border border-border-strong px-3 text-row" />
        </Field>
      </div>
      <Field label="Tags">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="school, vaccination" className="h-10 w-full rounded-md border border-border-strong px-3 text-row" />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-md border border-border-strong px-3 py-2 text-row" />
      </Field>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-4 pt-2">
        <button type="button" onClick={onDone} className="text-row font-medium text-muted">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="h-10 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-4 py-3">
      <dt className="w-32 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{v}</dd>
    </div>
  );
}

function describe(a: ActivityEntry): string {
  const m = a.metadata ?? {};
  switch (a.action) {
    case "document.upload":
      return `uploaded ${String(m.filename ?? "the file")}${m.filedTo ? " and filed it" : ""}`;
    case "document.new_version":
      return `added version ${String(m.version ?? "")}`;
    case "document.update":
      return `edited ${Array.isArray(m.fields) ? (m.fields as string[]).join(", ") : "details"}`;
    case "document.suggestion_accept":
      return "accepted the suggestion";
    case "document.suggestion_reject":
      return "rejected the suggestion";
    case "document.download":
      return `opened the original${m.version ? ` (v${String(m.version)})` : ""}`;
    case "document.delete":
      return "moved it to Recently deleted";
    case "document.restore":
      return "restored it";
    default:
      return a.action.replace("document.", "").replace(/_/g, " ");
  }
}
