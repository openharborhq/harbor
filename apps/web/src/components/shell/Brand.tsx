export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex size-[26px] items-center justify-center rounded-md bg-accent">
        <svg width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true">
          {/* Shield: a vault that guards, not a folder that files. */}
          <path d="M7.5 1.1 13 3.05v4.6c0 3.2-2.13 5.9-5.5 7.25C4.13 13.55 2 10.85 2 7.65v-4.6L7.5 1.1Z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-section font-semibold tracking-snug">Harbor</span>
    </div>
  );
}
