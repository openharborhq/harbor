"use client";

import Link from "next/link";
import { useState } from "react";
import type { AcceptInviteResult } from "@harbor/shared";
import { api } from "@/lib/api-client";

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<AcceptInviteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api<AcceptInviteResult>("/auth/invites/accept", { method: "POST", body: JSON.stringify({ token, displayName, password }) }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (result) {
    const secret = /secret=([A-Z2-7]+)/.exec(result.otpauthUri)?.[1] ?? "";
    return (
      <div className="mt-6 flex flex-col gap-5">
        <div>
          <div className="label">1 · Authenticator app</div>
          <p className="mt-1 text-row">Add a time-based code to your authenticator app with this key, or paste the full link below.</p>
          <code className="mt-2 block rounded-sm bg-surface px-3 py-2 text-[15px] tracking-[0.12em]">{secret}</code>
          <code className="mt-1.5 block break-all rounded-sm bg-surface px-3 py-2 text-label text-muted">{result.otpauthUri}</code>
        </div>
        <div>
          <div className="label">2 · Recovery codes</div>
          <p className="mt-1 text-row">Print these and keep them offline. Each works once. There is no password reset by email.</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 rounded-sm bg-surface px-3 py-2 font-mono text-row">
            {result.recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <Link href="/sign-in" className="flex h-11 items-center justify-center rounded-md bg-accent text-body font-semibold text-white">
          Done — sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Email</span>
        <input value={email} readOnly className="h-11 rounded-md border border-border bg-surface px-3.5 text-body text-muted" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Your name</span>
        <input required autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-11 rounded-md border border-border-strong px-3.5 text-body" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Password (12+ characters)</span>
        <input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-md border border-border-strong px-3.5 text-body" />
      </label>
      {error && <p className="text-small text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="mt-1 h-11 rounded-md bg-accent text-body font-semibold text-white disabled:opacity-60">
        {busy ? "Creating…" : "Create my account"}
      </button>
    </form>
  );
}
