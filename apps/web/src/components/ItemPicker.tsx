"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACTIVE_ITEM_KINDS, ITEM_KIND_LABEL, type Item, type ItemKind } from "@trustworthier/shared";
import { ItemIcon } from "./ItemIcon";

const PANEL_WIDTH = 420;

/**
 * FOR: the one control that answers "who or what is this about?" (Paper: "Inbox — For people and
 * things"). Selected people and things read as chips; "+ Add" opens one searchable list grouped by
 * kind, so the filer never picks a picker first. Things inside a thing sort last, and choosing a
 * child implies its parent — a boiler invoice is also about the house (spec §6).
 */
export function ItemPicker({
  items,
  selected,
  onChange,
  disabled = false,
  label = "For",
  suggested = false,
}: {
  items: Item[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  /** Adds "· suggested" to the label when the current selection is the model's. */
  suggested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  /** Measured on click, not during render: the FOR column often sits at the right edge of a card. */
  function openList() {
    const box = wrap.current?.getBoundingClientRect();
    if (box) setFlip(box.left + PANEL_WIDTH > window.innerWidth - 16);
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chips = selected.map((id) => byId.get(id)).filter((i): i is Item => i !== undefined);

  function toggle(item: Item) {
    if (selected.includes(item.id)) {
      onChange(selected.filter((x) => x !== item.id));
      return;
    }
    // Naming a child names its parent too: the boiler's invoice belongs to the house.
    const add = [item.id, ...(item.parentId && !selected.includes(item.parentId) ? [item.parentId] : [])];
    onChange([...selected, ...add.filter((id) => !selected.includes(id))]);
  }

  return (
    <div ref={wrap} className="relative flex flex-col gap-1.5">
      <span className="label">
        {label}
        {suggested ? " · suggested" : ""}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={openList}
        className="flex h-[42px] w-full items-center gap-2 overflow-hidden rounded-[10px] border border-border-strong bg-ground px-2.5 text-left disabled:opacity-60"
      >
        {chips.length === 0 && <span className="text-small text-muted">Nobody yet</span>}
        {chips.map((c) => (
          <span key={c.id} className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-sm bg-accent-soft px-2.5 text-small font-semibold text-accent">
            <ItemIcon kind={c.kind} />
            {c.label}
          </span>
        ))}
        <span className="flex-1" />
        <span className="shrink-0 text-small font-medium text-muted">+ Add</span>
      </button>

      {open && (
        <div className={`absolute top-[68px] z-20 flex w-[420px] max-w-[95vw] ${flip ? "right-0" : "left-0"} flex-col rounded-lg border border-border-strong bg-ground p-2.5 shadow-[0_8px_24px_rgba(13,22,34,0.1)]`}>
          <label className="mb-1.5 flex h-9 items-center gap-2.5 rounded-md border border-border px-3">
            <SearchIcon />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people and things"
              className="w-full bg-transparent text-row outline-none placeholder:text-muted"
            />
          </label>
          <div className="max-h-[320px] overflow-y-auto">
            <Groups items={items} query={query} selected={selected} onToggle={toggle} />
          </div>
          <Link href="/items" className="mt-1.5 border-t border-border px-3 pb-1 pt-2.5 text-row font-medium text-accent">
            + Add a person or thing
          </Link>
        </div>
      )}
    </div>
  );
}

function Groups({ items, query, selected, onToggle }: { items: Item[]; query: string; selected: string[]; onToggle: (i: Item) => void }) {
  const q = query.trim().toLowerCase();
  const match = (i: Item) => !q || i.label.toLowerCase().includes(q) || (i.parentLabel?.toLowerCase().includes(q) ?? false);
  const kinds: ItemKind[] = [...ACTIVE_ITEM_KINDS, ...(["policy", "pet", "business", "other"] as ItemKind[])];

  const top = kinds
    .map((k) => ({ k, rows: items.filter((i) => i.kind === k && i.parentId === null && match(i)) }))
    .filter((g) => g.rows.length > 0);
  // Things inside a thing sort last, under their parent's name.
  const nested = items
    .filter((i) => i.parentId !== null)
    .reduce<Map<string, Item[]>>((m, i) => m.set(i.parentLabel ?? "Inside", [...(m.get(i.parentLabel ?? "Inside") ?? []), i]), new Map());
  const nestedGroups = [...nested.entries()].map(([parent, rows]) => ({ parent, rows: rows.filter(match) })).filter((g) => g.rows.length > 0);

  if (top.length === 0 && nestedGroups.length === 0) return <p className="px-3 py-4 text-row text-muted">Nothing matches “{query}”.</p>;

  return (
    <>
      {top.map((g) => (
        <Section key={g.k} title={ITEM_KIND_LABEL[g.k].many} rows={g.rows} selected={selected} onToggle={onToggle} />
      ))}
      {nestedGroups.map((g) => (
        <Section key={g.parent} title={`In ${g.parent}`} rows={g.rows} selected={selected} onToggle={onToggle} />
      ))}
    </>
  );
}

function Section({ title, rows, selected, onToggle }: { title: string; rows: Item[]; selected: string[]; onToggle: (i: Item) => void }) {
  return (
    <>
      <div className="label px-3 pb-1 pt-3">{title}</div>
      {rows.map((i) => {
        const on = selected.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onToggle(i)}
            className={`flex h-[34px] w-full items-center gap-2.5 rounded-md px-3 text-left ${on ? "bg-accent-soft" : "hover:bg-surface"}`}
          >
            <Check on={on} />
            <span className={`min-w-0 flex-1 truncate text-row ${on ? "font-semibold text-accent" : "text-text"}`}>{i.label}</span>
            {i.documentCount > 0 && <span className={`shrink-0 text-small ${on ? "text-accent" : "text-muted"}`}>{i.documentCount}</span>}
          </button>
        );
      })}
    </>
  );
}

function Check({ on }: { on: boolean }) {
  if (!on) return <span className="size-4 shrink-0 rounded-sm border-[1.5px] border-border-strong" />;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-accent">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6.2 5 8.5 9.5 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
