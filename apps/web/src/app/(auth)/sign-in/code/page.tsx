import type { Metadata } from "next";
import { Brand } from "@/components/shell/Brand";
import { TotpForm } from "./TotpForm";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function CodePage(props: PageProps<"/sign-in/code">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/inbox";
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex w-[420px] flex-col items-center gap-7">
        <Brand />
        <div className="w-full rounded-lg border border-border bg-ground p-8">
          <h1 className="text-[24px] font-bold leading-[30px] tracking-snug">Two-factor code</h1>
          <p className="mt-1 text-body text-muted">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
          <TotpForm next={next} />
        </div>
      </div>
    </main>
  );
}
