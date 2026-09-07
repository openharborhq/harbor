"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";

export function RestoreButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/documents/${id}/restore`, { method: "POST" });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="h-[30px] rounded-md border border-border bg-ground px-3 text-small font-medium disabled:opacity-60"
    >
      {busy ? "Restoring…" : "Restore"}
    </button>
  );
}
