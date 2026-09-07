"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function PersonForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [dob, setDob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/people", { method: "POST", body: JSON.stringify({ displayName: name, relationship: relationship || null, dateOfBirth: dob || null }) });
      setName("");
      setRelationship("");
      setDob("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border-strong text-row font-medium text-muted hover:text-text">
        <span className="text-[22px] leading-none">+</span>
        Add a family member
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-border p-5">
      <label className="flex flex-col gap-1.5">
        <span className="label">Name</span>
        <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-md border border-border-strong px-3 text-row" placeholder="First name is enough" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Relationship</span>
        <input value={relationship} onChange={(e) => setRelationship(e.target.value)} className="h-10 rounded-md border border-border px-3 text-row" placeholder="Daughter, Father, …" />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Date of birth</span>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="h-10 rounded-md border border-border px-3 text-row" />
      </label>
      {error && <p className="text-small text-danger">{error}</p>}
      <div className="mt-1 flex items-center gap-3">
        <button type="submit" disabled={busy} className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60">
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-row font-medium text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}
