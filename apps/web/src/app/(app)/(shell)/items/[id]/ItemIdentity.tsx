"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ITEM_DETAIL_FIELDS, type Item } from "@harbor/shared";
import { api } from "@/lib/api-client";

/**
 * The item's name and its kind-specific details. Both were set once at creation with no way back
 * — an address changes, a plate changes, and a name typed in a hurry is worth fixing.
 */
export function ItemIdentity({ item, headline }: { item: Item; headline: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [details, setDetails] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(item.details).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = ITEM_DETAIL_FIELDS[item.kind];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim() !== ""));
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ label: label.trim(), details: clean }) });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setLabel(item.label);
    setDetails(Object.fromEntries(Object.entries(item.details).map(([k, v]) => [k, typeof v === "string" ? v : String(v ?? "")])));
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <>
        <h1 className="mt-1 flex items-baseline gap-3 text-title font-bold tracking-snug">
          {item.label}
          <button type="button" onClick={() => setEditing(true)} className="text-small font-medium text-accent">
            Edit
          </button>
        </h1>
        <p className="mt-1 text-body text-muted">{headline}</p>
      </>
    );
  }

  return (
    <form onSubmit={save} className="mt-1 flex max-w-[420px] flex-col gap-2.5">
      <input
        autoFocus
        required
        maxLength={120}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-11 rounded-md border border-border-strong px-3 text-section font-semibold"
      />
      {fields.map((f) => (
        <label key={f.key} className="flex items-center gap-3">
          <span className="label w-24 shrink-0">{f.label}</span>
          <input
            type={f.type}
            value={details[f.key] ?? ""}
            onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="h-9 flex-1 rounded-md border border-border px-3 text-row"
          />
        </label>
      ))}
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy || !label.trim()} className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={cancel} className="text-row font-medium text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}
