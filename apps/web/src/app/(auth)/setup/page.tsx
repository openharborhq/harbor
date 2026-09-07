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
          {/* The heading belongs to the form: once the account exists, "no owner yet" is a lie. */}
          <SetupForm />
        </div>
        <p className="max-w-[420px] text-center text-small text-muted">Every owner sees everything. Sign-in is a password plus an authenticator code; there is no email reset, so the recovery codes on the next screen matter.</p>
      </div>
    </main>
  );
}
