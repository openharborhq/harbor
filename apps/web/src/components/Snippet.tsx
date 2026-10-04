/**
 * Render a ts_headline snippet safely: only <mark>…</mark> is honoured, everything else is text.
 * The API emits exactly those two tags (see SearchService); nothing is injected as HTML.
 *
 * Below lg it is read at 15/22 in the muted colour (spec §4.3), so the marked words are what
 * stands out of a narrow column, and it stops at three lines: ts_headline's passage is sized for a
 * desktop row, and at a phone's width it ran to six. From lg up it is the 13px line it has always
 * been.
 */
export function Snippet({ html, className = "" }: { html: string; className?: string }) {
  const parts = html.split(/(<mark>.*?<\/mark>)/g).filter(Boolean);
  return (
    <p className={`line-clamp-3 text-body text-muted lg:line-clamp-none lg:text-small lg:leading-[18px] lg:text-text ${className}`}>
      {parts.map((p, i) => {
        const m = /^<mark>(.*?)<\/mark>$/.exec(p);
        return m ? <mark key={i}>{m[1]}</mark> : <span key={i}>{p}</span>;
      })}
    </p>
  );
}
