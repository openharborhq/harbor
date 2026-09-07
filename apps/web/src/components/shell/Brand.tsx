export function Brand({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex size-[26px] items-center justify-center rounded-md bg-accent">
        <div className="h-[13px] w-[11px] rounded-[2px] border-2 border-white" />
      </div>
      <span className="text-section font-semibold tracking-snug">Trustworthier</span>
    </div>
  );
}
