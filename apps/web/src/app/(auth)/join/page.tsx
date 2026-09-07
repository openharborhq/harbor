import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import { JoinForm } from "./JoinForm";

export const metadata: Metadata = { title: "Join the vault" };

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export default async function JoinPage(props: PageProps<"/join">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const check = token ? ((await (await fetch(`${API}/auth/invites/check?token=${encodeURIComponent(token)}`, { cache: "no-store" })).json()) as { valid: boolean; email?: string }) : { valid: false };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex w-[480px] flex-col items-center gap-7">
        <Brand />
        <div className="w-full rounded-lg border border-border bg-ground p-8">
          {check.valid ? (
            <>
              <h1 className="text-[24px] font-bold leading-[30px] tracking-snug">You&rsquo;re invited</h1>
              <p className="mt-1 text-body text-muted">Create your owner account for {check.email}. You will see everything the other owners see.</p>
              <JoinForm token={token} email={check.email!} />
            </>
          ) : (
            <>
              <h1 className="text-[24px] font-bold leading-[30px] tracking-snug">This invitation isn&rsquo;t valid</h1>
              <p className="mt-1 text-body text-muted">It may have been used already or expired after 48 hours. Ask the person who invited you for a new link.</p>
              <p className="mt-6 text-row">
                <Link href="/sign-in" className="font-medium text-accent">
                  Already have an account? Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
