import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/** One side of the stepper: the neighbouring record's address and the name it is known by ("Bayview Data · BVD-2026-0930"). */
export type RecordNeighbour = { href: string; label: string } | null | undefined;

/**
 * Previous / next on an Accounting record page (round 7, owner 2026-11-10: mockups-r7/accounting.html). The buttons
 * name the record they open, never a generic word, and walk the list the record was opened from. Placed in the
 * frame's `actions`, before the page's own buttons, as on Carrier terms and a Retention case. Draws nothing
 * when the record has no neighbours.
 */
export function RecordStepper({ previous, next, noun }: { previous?: RecordNeighbour; next?: RecordNeighbour; noun: string }) {
  if (!previous && !next) return null;
  return (
    <>
      {previous && (
        <Link href={previous.href} className={buttonVariants({ variant: "outline" })} title={`Previous ${noun}: ${previous.label}`}>
          <ChevronLeft aria-hidden="true" />
          <span className="max-w-56 truncate">{previous.label}</span>
        </Link>
      )}
      {next && (
        <Link href={next.href} className={buttonVariants({ variant: "outline" })} title={`Next ${noun}: ${next.label}`}>
          <span className="max-w-56 truncate">{next.label}</span>
          <ChevronRight aria-hidden="true" />
        </Link>
      )}
    </>
  );
}

/** The records either side of `id` in `ordered` (the list as it was shown), or null at either end. */
export function neighboursOf<T>(ordered: readonly T[], id: string, idOf: (row: T) => string): { previous: T | null; next: T | null } {
  const at = ordered.findIndex((row) => idOf(row) === id);
  if (at < 0) return { previous: null, next: null };
  return { previous: at > 0 ? ordered[at - 1] : null, next: at < ordered.length - 1 ? ordered[at + 1] : null };
}
