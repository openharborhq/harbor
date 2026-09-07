import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One shape for "there is nothing here yet". Empty is the state a new vault spends most of its
 * first week in, so every one of these says what would fill it and offers the way to do that,
 * rather than leaving a blank rectangle.
 */
export function EmptyState({
  title,
  body,
  action,
  href,
  compact = false,
  children,
}: {
  title: string;
  body: string;
  action?: string;
  href?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`flex flex-col items-start gap-1.5 rounded-lg border border-dashed border-border-strong ${compact ? "px-5 py-5" : "px-7 py-9"}`}>
      <p className="text-row font-semibold">{title}</p>
      <p className="max-w-[520px] text-body text-muted">{body}</p>
      {action && href && (
        <Link href={href} className="mt-2 h-9 rounded-md bg-accent px-4 text-row font-semibold leading-9 text-white">
          {action}
        </Link>
      )}
      {children}
    </div>
  );
}
