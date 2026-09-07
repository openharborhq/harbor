"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function TotpForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/totp", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      router.push(next.startsWith("/") ? next : "/inbox");
      router.refresh();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 401 && !(err as Error).message ? "That code didn't work." : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Code</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          className="h-[58px] rounded-md border border-border-strong px-4 text-[24px] font-semibold tracking-[0.2em] outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <p className="text-small text-muted">Codes change every 30 seconds. If yours was just rejected, wait for the next one.</p>
      {error && <p className="text-small text-danger">{error}</p>}
      <button type="submit" disabled={busy || code.trim().length < 6} className="h-11 rounded-md bg-accent text-body font-semibold text-white disabled:opacity-60">
        {busy ? "Verifying…" : "Verify"}
      </button>
      <p className="text-center text-small text-muted">Lost your authenticator? Type one of your printed recovery codes instead.</p>
    </form>
  );
}
