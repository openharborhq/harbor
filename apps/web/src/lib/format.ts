export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function pages(n: number | null): string {
  if (n === null) return "";
  return n === 1 ? "1 page" : `${n} pages`;
}

/** Whole days from today until an ISO date (negative when past). Kept out of render for the React compiler. */
export function daysUntil(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
}

export function ageFrom(isoDob: string): number {
  return Math.floor((Date.now() - Date.parse(isoDob)) / (365.25 * 86_400_000));
}

export function isFuture(iso: string): boolean {
  return Date.parse(iso) > Date.now();
}
