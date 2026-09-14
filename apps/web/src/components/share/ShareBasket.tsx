"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

/**
 * The share basket (spec §10.5).
 *
 * Sharing starts from the documents, not from a Share page, so the basket has to survive moving
 * between them — a search, then an item, then the inbox. It is **per-browser and ephemeral**: not
 * a saved collection, and not synced anywhere. The durable object is the share, which only exists
 * once the review screen has been through.
 *
 * Documents only. An item cannot go in, not even as a shortcut that expands to what is filed under
 * it: whatever the review screen showed, someone who dropped in *the car* would believe they had
 * sent the car, and a document filed next year would be missing from a link they thought covered
 * it (§10.5).
 *
 * `localStorage` is the store rather than React state, read through `useSyncExternalStore`, for
 * two reasons: the basket has to survive a full page navigation between server-rendered pages, and
 * two tabs adding to it should agree. Anything that can throw here — a private window, a full
 * quota — degrades to an in-memory basket rather than an error the person has to read.
 */
export interface BasketDocument {
  id: string;
  title: string;
}

interface BasketValue {
  documents: BasketDocument[];
  has: (id: string) => boolean;
  add: (doc: BasketDocument) => void;
  remove: (id: string) => void;
  toggle: (doc: BasketDocument) => void;
  clear: () => void;
  /** False during the server render and the first paint, so nothing flashes an empty basket. */
  ready: boolean;
}

const KEY = "harbor.share.basket";
const EMPTY: BasketDocument[] = [];

const listeners = new Set<() => void>();
/**
 * `useSyncExternalStore` calls the snapshot on every render and compares by identity, so parsing
 * afresh each time would loop forever. The parsed value is cached against the raw string it came
 * from, and a new array only appears when the stored text actually changed.
 */
let cachedRaw: string | null = null;
let cachedValue: BasketDocument[] = EMPTY;

function read(): BasketDocument[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cachedValue;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as BasketDocument[]) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function write(next: BasketDocument[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private windows and full quotas both land here */
  }
  // Keep the cache in step even when the write failed, so the basket still works in memory.
  cachedRaw = JSON.stringify(next);
  cachedValue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab adding to the basket fires this; our own writes notify directly.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const ShareBasketContext = createContext<BasketValue | null>(null);

export function ShareBasketProvider({ children }: { children: ReactNode }) {
  const documents = useSyncExternalStore(subscribe, read, () => EMPTY);
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const value = useMemo<BasketValue>(
    () => ({
      documents,
      ready,
      has: (id) => documents.some((d) => d.id === id),
      add: (doc) => {
        if (!documents.some((d) => d.id === doc.id)) write([...documents, doc]);
      },
      remove: (id) => write(documents.filter((d) => d.id !== id)),
      toggle: (doc) =>
        documents.some((d) => d.id === doc.id) ? write(documents.filter((d) => d.id !== doc.id)) : write([...documents, doc]),
      clear: () => write([]),
    }),
    [documents, ready],
  );

  return <ShareBasketContext.Provider value={value}>{children}</ShareBasketContext.Provider>;
}

export function useShareBasket(): BasketValue {
  const ctx = useContext(ShareBasketContext);
  if (!ctx) throw new Error("useShareBasket must be used inside ShareBasketProvider");
  return ctx;
}
