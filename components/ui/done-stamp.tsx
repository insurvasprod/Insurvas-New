import { cn } from "@/lib/utils";

/**
 * A completion stamp (Tier 2 motion, 2026-11-17): "Paid", "Matched", "Month closed", "Done". When it mounts the
 * check strokes in and the label pops, all within --t-stamp (400ms), once — then it is a plain chip in the badge
 * shape (§5a). Remount it (a new `key`) to play it again. Server-safe: the motion is all CSS.
 */
export function DoneStamp({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("m-stamp inline-flex h-[22px] w-fit items-center gap-1 whitespace-nowrap rounded-badge bg-[var(--success-surface)] px-2 text-xs leading-none font-medium text-[var(--success-ink)]", className)}>
      <StampCheck />
      <span data-stamp-label="">{label}</span>
    </span>
  );
}

/** The check that draws itself (`m-stamp-check`, a path with pathLength 1), for a stamp or an upload that finished. */
export function StampCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-3.5 shrink-0", className)}>
      <path className="m-stamp-check" pathLength={1} d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
