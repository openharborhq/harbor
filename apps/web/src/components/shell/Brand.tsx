/**
 * The Harbor lockup, the same one the website carries: a shield with an anchor inside it.
 *
 * The shield says what the vault is for and the anchor says what it is — a home port for the
 * paperwork, not a filing cabinet. Drawn in the accent colour rather than reversed out of a filled
 * tile, so the mark reads the same in the app as it does on the site.
 */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-[7px] ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="shrink-0 text-accent" aria-hidden="true">
        <path
          d="M13 2.5 L22.5 7 L22.5 14.5 C22.5 19.5 18.4 22.8 13 24 C7.6 22.8 3.5 19.5 3.5 14.5 L3.5 7 Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M13 8.5 L13 17.5 M8.6 12.4 C8.6 12.4 10.2 14.6 13 14.6 C15.8 14.6 17.4 12.4 17.4 12.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-section font-bold tracking-snug">Harbor</span>
    </div>
  );
}
