import { cookies } from "next/headers";
import { cache } from "react";
import type { SessionUser } from "@harbor/shared";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to the Nest API, forwarding the browser's session cookie. Never cached. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieStore = await cookies();
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), cookie: cookieStore.toString() },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * The signed-in user, or null when the session is missing/expired/pending.
 *
 * Cached for the render, because both the layout that guards the route and the page inside it
 * want the user, and that should not be two calls to the API on every navigation.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const { user } = await apiFetch<{ user: SessionUser }>("/auth/me");
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
});
