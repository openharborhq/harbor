import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/Brand";
import { SetupForm } from "./SetupForm";
import { setupNeeded } from "./status";

export const metadata: Metadata = { title: "Set up your vault" };

/**
 * First run (spec §3.7): shown while the vault has no owner, and only then. There are no default
 * credentials to change and nothing to type on a console — the first person to open the page
 * becomes the first owner, and invites everyone else from Settings.
 */
export default async function SetupPage() {
  if (!(await setupNeeded())) redirect("/sign-in");
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex w-[480px] flex-col items-center gap-7">
        <Brand />
        <div className="w-full rounded-lg border border-border bg-ground p-8">
          <h1 className="text-[24px] font-bold leading-[30px] tracking-snug">Set up your vault</h1>
          <p className="mt-1 text-body text-muted">This vault has no owner yet. Create the first account — the one that invites the rest of the household from Settings.</p>
          <SetupForm />
        </div>
        <p className="max-w-[420px] text-center text-small text-muted">Every owner sees everything. Sign-in is a password plus an authenticator code; there is no email reset, so the recovery codes on the next screen matter.</p>
      </div>
    </main>
  );
}
