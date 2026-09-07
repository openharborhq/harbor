"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push(`/sign-in/code?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-md border border-border-strong px-3.5 text-body outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Password</span>
        <div className="flex h-11 items-center rounded-md border border-border-strong px-3.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          <input
            type={show ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-body outline-none"
          />
          <button type="button" onClick={() => setShow((s) => !s)} className="text-small font-medium text-muted">
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </label>
      {error && <p className="text-small text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="mt-1 h-11 rounded-md bg-accent text-body font-semibold text-white disabled:opacity-60">
        {busy ? "Checking…" : "Continue"}
      </button>
      <p className="text-center text-small text-muted">
        There is no password reset by email — on purpose.
        <br />
        <span className="font-medium text-accent">Use a recovery code</span> on the next step if you&rsquo;ve lost your authenticator.
      </p>
    </form>
  );
}
