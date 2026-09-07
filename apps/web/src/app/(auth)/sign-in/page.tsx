import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/Brand";
import { SignInForm } from "./SignInForm";
import { setupNeeded } from "../setup/status";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/inbox";
  // A vault with no owner has nobody who could sign in: first run goes to /setup instead.
  if (await setupNeeded()) redirect("/setup");
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex w-[420px] flex-col items-center gap-7">
        <Brand />
        <div className="w-full rounded-lg border border-border bg-ground p-8">
          <h1 className="text-[24px] font-bold leading-[30px] tracking-snug">Sign in</h1>
          <p className="mt-1 text-body text-muted">The family vault</p>
          <SignInForm next={next} />
        </div>
        <p className="flex items-center gap-2 text-small text-muted">
          <LockIcon /> Reachable only on your tailnet, never the open internet.
        </p>
      </div>
    </main>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
