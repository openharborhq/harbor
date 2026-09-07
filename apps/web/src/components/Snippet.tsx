/**
 * Render a ts_headline snippet safely: only <mark>…</mark> is honoured, everything else is text.
 * The API emits exactly those two tags (see SearchService); nothing is injected as HTML.
 */
export function Snippet({ html, className = "" }: { html: string; className?: string }) {
  const parts = html.split(/(<mark>.*?<\/mark>)/g).filter(Boolean);
  return (
    <p className={`text-small leading-[18px] text-text ${className}`}>
      {parts.map((p, i) => {
        const m = /^<mark>(.*?)<\/mark>$/.exec(p);
        return m ? <mark key={i}>{m[1]}</mark> : <span key={i}>{p}</span>;
      })}
    </p>
  );
}
