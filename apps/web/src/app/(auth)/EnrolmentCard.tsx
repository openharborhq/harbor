"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * What a new owner sees exactly once: the authenticator key and the recovery codes. Shared by
 * the first-run setup and the invitation flow, because the moment is the same in both — the
 * only difference is how the account came to exist.
 */
export function EnrolmentCard({ otpauthUri, recoveryCodes, doneHref = "/sign-in", doneLabel = "Done — sign in" }: { otpauthUri: string; recoveryCodes: string[]; doneHref?: string; doneLabel?: string }) {
  const secret = /secret=([A-Z2-7]+)/.exec(otpauthUri)?.[1] ?? "";
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  /**
   * Drawn in the browser from the URI the page already has, rather than fetched as an image: the
   * secret should not travel a second time, and it should never sit in a server log or a proxy
   * cache. If it cannot be drawn for any reason the key below is still there to type, which is
   * how this screen worked before the code existed.
   */
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M", margin: 1, width: 320 })
      .then((url) => live && setQr(url))
      .catch(() => live && setQrFailed(true));
    return () => {
      live = false;
    };
  }, [otpauthUri]);

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div>
        <div className="label">1 · Authenticator app</div>
        <p className="mt-1 text-row">Scan this with your authenticator app. If you cannot scan it, type the key underneath instead.</p>

        <div className="mt-3 flex justify-center rounded-sm bg-white p-3">
          {qr ? (
            // The alt text deliberately does not carry the secret: it is read aloud by screen
            // readers and copied into bug reports.
            <img src={qr} alt="Authenticator setup code" width={220} height={220} className="size-[220px]" />
          ) : (
            <div className="flex size-[220px] items-center justify-center text-small text-muted">
              {qrFailed ? "Could not draw the code — use the key below." : "Drawing the code…"}
            </div>
          )}
        </div>

        <code className="mt-2 block rounded-sm bg-surface px-3 py-2 text-center text-[15px] tracking-[0.12em]">{secret}</code>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-small text-muted">Show the full setup link</summary>
          <code className="mt-1.5 block break-all rounded-sm bg-surface px-3 py-2 text-label text-muted">{otpauthUri}</code>
        </details>
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
