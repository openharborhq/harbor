import type { ReleaseNote } from "@harbor/shared";
import { Badge } from "../ui";

/**
 * What changed in each release, beside the version that is running.
 *
 * The bodies are the same notes that go on the GitHub release page, which means they are text
 * written for a person rather than a list of commits — the only form of "what's new" worth
 * putting in front of someone deciding whether to upgrade the box their documents live on.
 */
export function ReleaseNotes({ releases, offline }: { releases: ReleaseNote[]; offline: boolean }) {
  if (releases.length === 0) return null;
  return (
    <aside className="flex w-[380px] shrink-0 flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="label">What&rsquo;s new</h2>
        {offline && <span className="text-small text-muted">This image only</span>}
      </div>

      <div className="flex flex-col rounded-md border border-border">
        {releases.map((r, i) => (
          // A native disclosure: seven releases of notes is a wall of text, and nobody arrives
          // here wanting to read all of it. No JavaScript, so it works before the page hydrates.
          <details key={r.version} open={i === 0} className="group border-b border-border last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-surface [&::-webkit-details-marker]:hidden">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted transition-transform group-open:rotate-90">
                <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-mono text-row font-semibold">{r.version}</span>
              {r.isCurrent && <Badge>Running</Badge>}
              {r.isNewer && <Badge tone="warn">Not installed</Badge>}
              {r.date && <span className="ml-auto shrink-0 pl-2 text-small text-muted">{r.date}</span>}
            </summary>
            <div className="flex flex-col gap-2 pr-4 pb-4 pl-[30px] text-small leading-[19px] text-muted">{blocks(r.body, r.version)}</div>
          </details>
        ))}
      </div>
    </aside>
  );
}

/**
 * A deliberately small Markdown subset — paragraphs, bullets, bold, code and links — rendered as
 * React elements rather than injected HTML. The bodies come from GitHub, so nothing here may take
 * a path that can put markup on the page.
 */
function blocks(markdown: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const items: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (items.length === 0) return;
    const own = [...items];
    out.push(
      <ul key={`${keyPrefix}-l${out.length}`} className="flex list-disc flex-col gap-1.5 pl-4">
        {own.map((item, i) => (
          <li key={i}>{inline(item, `${keyPrefix}-l${out.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    items.length = 0;
  };
  const flushPara = () => {
    if (para.length === 0) return;
    out.push(<p key={`${keyPrefix}-p${out.length}`}>{inline(para.join(" "), `${keyPrefix}-p${out.length}`)}</p>);
    para = [];
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushList();
      flushPara();
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      items.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^\s+\S/.test(line) && items.length > 0) {
      // A wrapped bullet: the changelog indents continuation lines rather than making new items.
      items[items.length - 1] += ` ${line.trim()}`;
    } else if (/^#{1,6}\s/.test(line)) {
      flushList();
      flushPara();
      out.push(
        <p key={`${keyPrefix}-h${out.length}`} className="font-semibold text-text">
          {line.replace(/^#{1,6}\s+/, "")}
        </p>,
      );
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList();
  flushPara();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold text-text">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={key} className="rounded-sm bg-surface px-1 font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        );
      }
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        // Only ordinary web links are followed; anything else is shown as its own text.
        if (!/^https?:\/\//i.test(link[2])) return <span key={key}>{link[1]}</span>;
        return (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">
            {link[1]}
          </a>
        );
      }
      return <span key={key}>{part}</span>;
    });
}
