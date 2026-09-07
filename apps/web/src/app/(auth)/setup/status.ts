import type { SetupStatus } from "@harbor/shared";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Unauthenticated by design; an API that cannot be reached counts as "not first run" so sign-in still renders. */
export async function setupNeeded(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/auth/setup`, { cache: "no-store" });
    if (!res.ok) return false;
    return ((await res.json()) as SetupStatus).needed;
  } catch {
    return false;
  }
}
