"use client";

import { useState } from "react";
import type { AcceptInviteResult } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { EnrolmentCard } from "../EnrolmentCard";

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

  if (result) return <EnrolmentCard otpauthUri={result.otpauthUri} recoveryCodes={result.recoveryCodes} />;

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
