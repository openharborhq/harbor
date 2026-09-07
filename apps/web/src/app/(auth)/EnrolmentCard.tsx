import Link from "next/link";

/**
 * What a new owner sees exactly once: the authenticator key and the recovery codes. Shared by
 * the first-run setup and the invitation flow, because the moment is the same in both — the
 * only difference is how the account came to exist.
 */
export function EnrolmentCard({ otpauthUri, recoveryCodes, doneHref = "/sign-in", doneLabel = "Done — sign in" }: { otpauthUri: string; recoveryCodes: string[]; doneHref?: string; doneLabel?: string }) {
  const secret = /secret=([A-Z2-7]+)/.exec(otpauthUri)?.[1] ?? "";
  return (
    <div className="mt-6 flex flex-col gap-5">
      <div>
        <div className="label">1 · Authenticator app</div>
        <p className="mt-1 text-row">Add a time-based code to your authenticator app with this key, or paste the full link below.</p>
        <code className="mt-2 block rounded-sm bg-surface px-3 py-2 text-[15px] tracking-[0.12em]">{secret}</code>
        <code className="mt-1.5 block break-all rounded-sm bg-surface px-3 py-2 text-label text-muted">{otpauthUri}</code>
      </div>
      <div>
        <div className="label">2 · Recovery codes</div>
        <p className="mt-1 text-row">Print these and keep them offline. Each works once. There is no password reset by email.</p>
        <ul className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 rounded-sm bg-surface px-3 py-2 font-mono text-row">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <Link href={doneHref} className="flex h-11 items-center justify-center rounded-md bg-accent text-body font-semibold text-white">
        {doneLabel}
      </Link>
    </div>
  );
}
