import type { Metadata } from "next";
import { formatDate, formatRelative } from "@/lib/format";
import { getSessions } from "../data";
import { RevokeSessionButton } from "../forms";
import { Badge, PageHead, Row, Rows } from "../ui";

export const metadata: Metadata = { title: "Devices · Settings" };

export default async function DevicesPage() {
  const sessions = await getSessions();

  return (
    <>
      <PageHead title="Devices">
        Every browser currently signed in to this vault. Sessions last 30 days and renew while they are being used. Sign
        out anything you do not recognise — it takes effect on the next request that device makes.
      </PageHead>

      <Rows>
        {sessions.map((s) => (
          <Row key={s.id}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-row font-medium">
                <span className="truncate">{shortAgent(s.userAgent)}</span>
                {s.current && <Badge>This device</Badge>}
              </div>
              <div className="truncate text-small text-muted">
                {s.ip ?? "unknown address"} · signed in {formatRelative(s.createdAt)} · expires {formatDate(s.expiresAt)}
              </div>
            </div>
            {!s.current && <RevokeSessionButton id={s.id} />}
          </Row>
        ))}
      </Rows>
    </>
  );
}

function shortAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\/|Edg\/|Chrome\/|Safari\//.exec(ua)?.[0].replace("/", "") ?? "Browser";
  const os = /Macintosh|Windows|iPhone|iPad|Android|Linux/.exec(ua)?.[0] ?? "";
  return `${browser === "Safari" && /Chrome/.test(ua) ? "Chrome" : browser}${os ? ` on ${os === "Macintosh" ? "Mac" : os}` : ""}`;
}
