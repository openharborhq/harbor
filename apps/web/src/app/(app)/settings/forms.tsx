"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InviteInfo, RecoveryCodesResult } from "@trustworthier/shared";
import { api } from "@/lib/api-client";

const input = "h-10 w-full rounded-md border border-border-strong px-3 text-row";
const primary = "h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60";
const secondary = "h-9 rounded-md border border-border bg-ground px-4 text-row font-medium";

export function NameForm({ current }: { current: string }) {
  const router = useRouter();
  const [name, setName] = useState(current);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await api("/auth/profile", { method: "PATCH", body: JSON.stringify({ displayName: name }) });
      setState("done");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }
  return (
    <form onSubmit={submit} className="flex max-w-[520px] items-center gap-3">
      <input
        required
        maxLength={80}
        autoComplete="name"
        placeholder="Kai Pradel"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setState("idle");
        }}
        className={`${input} max-w-[280px]`}
      />
      <button type="submit" disabled={state === "busy" || name.trim() === current} className={secondary}>
        {state === "busy" ? "Saving…" : "Save"}
      </button>
      {state === "done" && <span className="text-small text-muted">Saved.</span>}
      {error && <span className="text-small text-danger">{error}</span>}
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setCurrent("");
      setNext("");
      setState("done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  }
  return (
    <form onSubmit={submit} className="flex max-w-[520px] flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <input type="password" required autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
        <input type="password" required minLength={12} autoComplete="new-password" placeholder="New password (12+ characters)" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "busy"} className={secondary}>
          {state === "busy" ? "Changing…" : "Change password"}
        </button>
        {state === "done" && <span className="text-small text-muted">Changed.</span>}
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </form>
  );
}

export function RecoveryCodesForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<RecoveryCodesResult>("/auth/recovery-codes", { method: "POST", body: JSON.stringify({ password }) });
      setCodes(r.codes);
      setPassword("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (codes) {
    return (
      <div className="rounded-md border border-warn/40 bg-warn-soft p-4">
        <p className="text-row font-medium">Your new recovery codes. The old ones no longer work. Print this, then close it — it will not be shown again.</p>
        <ul className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-row">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button type="button" onClick={() => setCodes(null)} className="mt-4 text-row font-medium text-accent">
          I&rsquo;ve printed them
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex max-w-[520px] items-center gap-3">
      <input type="password" required autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      <button type="submit" disabled={busy} className={`${secondary} shrink-0`}>
        {busy ? "…" : "Regenerate"}
      </button>
      {error && <span className="text-small text-danger">{error}</span>}
    </form>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<InviteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api<InviteInfo>("/auth/invites", { method: "POST", body: JSON.stringify({ email, password }) }));
      setEmail("");
      setPassword("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (result?.url) {
    return (
      <div className="rounded-md bg-surface p-4">
        <p className="text-row font-medium">Invitation for {result.email}. Send them this link yourself — it works once and expires in 48 hours. It will not be shown again.</p>
        <code className="mt-2 block break-all rounded-sm bg-ground px-3 py-2 text-small">{result.url}</code>
        <button type="button" onClick={() => setResult(null)} className="mt-3 text-row font-medium text-accent">
          Done
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondary}>
        Invite someone
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <input type="email" required placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        <input type="password" required autoComplete="current-password" placeholder="Your password, to confirm" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Creating…" : "Create invitation link"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-row font-medium text-muted">
          Cancel
        </button>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </form>
  );
}

export function RevokeSessionButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/auth/sessions/${id}`, { method: "DELETE" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="text-row font-medium text-accent disabled:opacity-60"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
