/**
 * The vocabulary every Settings section is built from, so seven pages written at seven different
 * times still read as one screen: a heading with a sentence under it, metric cards for the
 * numbers that answer "is this working", and a fact table for the settings themselves.
 */

/** The heading of a section. The sentence under it says what the section is for, in plain words. */
export function PageHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="flex max-w-[620px] flex-col gap-2.5">
      <h1 className="text-[26px] font-bold leading-8 tracking-snug">{title}</h1>
      <p className="text-body text-muted">{children}</p>
    </header>
  );
}

export function Stats({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-[620px] flex-wrap gap-5">{children}</div>;
}

/** One number worth reading from across the room, with the detail that makes it checkable. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-[200px] grow basis-0 flex-col gap-1.5 rounded-md border border-border px-5 py-[18px]">
      <div className="label">{label}</div>
      <div className="text-[22px] font-bold leading-7 tracking-snug">{value}</div>
      {sub && <div className="text-small text-muted">{sub}</div>}
    </div>
  );
}

export function Facts({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-[620px] flex-col rounded-md border border-border">{children}</div>;
}

/** A labelled row. `action` is the right-hand lane — kept reserved so rows line up without it. */
export function Fact({ k, action, children }: { k: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-5 border-b border-border px-5 py-3.5 last:border-b-0">
      <div className="w-[132px] shrink-0 text-row leading-[18px] text-muted">{k}</div>
      <div className="min-w-0 grow text-row leading-[21px]">{children}</div>
      <div className="w-[52px] shrink-0 text-right text-small font-medium text-accent">{action}</div>
    </div>
  );
}

/** The small uppercase label that names a group of controls. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="label mb-0.5">{children}</div>;
}

/** A block that holds something back — the plain account of what a choice costs you. */
export function Note({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex max-w-[620px] flex-col gap-3 rounded-md bg-surface px-[18px] py-4">
      {title && <div className="text-row font-semibold">{title}</div>}
      <div className="text-small leading-[20px] text-muted">{children}</div>
    </div>
  );
}

/** A labelled control with the sentence that explains what changing it does. */
export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex max-w-[620px] flex-col gap-2">
      <div className="label">{label}</div>
      {hint && <p className="text-small leading-[19px] text-muted">{hint}</p>}
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** A small, quiet marker: "You", "This device", "Update available". Never more than a word or two. */
export function Badge({ tone = "accent", children }: { tone?: "accent" | "muted" | "danger" | "warn"; children: React.ReactNode }) {
  const cls = {
    accent: "bg-accent-soft text-accent",
    muted: "bg-surface text-muted",
    danger: "bg-danger/10 text-danger",
    warn: "bg-warn-soft text-warn",
  }[tone];
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-label font-bold uppercase tracking-label ${cls}`}>{children}</span>;
}

/** A bordered list of people, devices or runs — the same shell as Facts, without the label lane. */
export function Rows({ children }: { children: React.ReactNode }) {
  return <div className="flex max-w-[620px] flex-col rounded-md border border-border">{children}</div>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0">{children}</div>;
}
