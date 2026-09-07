"use client";

import { useState } from "react";
import type { AcceptInviteResult } from "@harbor/shared";
import { api } from "@/lib/api-client";
import { EnrolmentCard } from "../EnrolmentCard";

const input = "h-11 rounded-md border border-border-strong px-3.5 text-body";

export function SetupForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<AcceptInviteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords differ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api<AcceptInviteResult>("/auth/setup", { method: "POST", body: JSON.stringify({ email, displayName, password }) }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (result) return <EnrolmentCard otpauthUri={result.otpauthUri} recoveryCodes={result.recoveryCodes} doneLabel="I've saved these — sign in" />;

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Your name</span>
        <input required autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" className={input} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className={input} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Password (12+ characters)</span>
        <input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Password again</span>
        <input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
      </label>
      {error && <p className="text-small text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="mt-1 h-11 rounded-md bg-accent text-body font-semibold text-white disabled:opacity-60">
        {busy ? "Creating…" : "Create the first owner"}
      </button>
    </form>
  );
}
