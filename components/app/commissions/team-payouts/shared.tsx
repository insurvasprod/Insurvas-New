import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Commissions round 7 (owner 2026-11-10, docs/la4/mockups-r7/commissions.html 6–9): what the money-out record pages
 * share. Server-safe (no hooks), so a server page and a client board read one formatter.
 */

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 3, 2026" (one date style on every money-out page); "—" for no date. Reads the YYYY-MM-DD part only. */
export function usDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
}

/** "Oct 6" (the year is on the page already). */
export function usDay(value: string | null | undefined): string {
  if (!value) return "—";
  const [, m, d] = value.slice(0, 10).split("-").map(Number);
  return m && d ? `${MONTH_SHORT[m - 1]} ${d}` : "—";
}

/** "October 2026" for YYYY-MM. */
export function longMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "October" for YYYY-MM (a tab's "Pay October"). */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

/** A period as words: "October 2026" for a whole month, else "Oct 1 – Oct 15, 2026". */
export function periodWords(start: string, end: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  const last = new Date(Date.UTC(ys, ms, 0)).getUTCDate();
  if (ds === 1 && start.slice(0, 7) === end.slice(0, 7) && Number(end.slice(8, 10)) === last) return longMonth(start.slice(0, 7));
  return start.slice(0, 4) === end.slice(0, 4) ? `${usDay(start)} – ${usDate(end)}` : `${usDate(start)} – ${usDate(end)}`;
}

/** How a team member was paid, by its label ("Bank transfer"), never the stored key. */
export function payMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  const key = method.toLowerCase();
  if (key === "ach" || key === "bank_transfer") return "Bank transfer";
  if (key === "cheque" || key === "check") return "Check";
  if (key === "paypal") return "PayPal";
  if (key === "zelle") return "Zelle";
  if (key === "wire") return "Wire";
  if (key === "card") return "Card";
  if (key === "other") return "Other";
  return method;
}

export type Neighbour = { href: string; label: string } | null;

/**
 * A record page's ‹ › (round 7 rule): each names the record it opens ("‹ Ruth Alvarez"); at an end it reads
 * "None before" / "None after", disabled. Goes in the frame's `actions`, before the page's own buttons.
 */
export function NeighbourNav({ previous, next, noun }: { previous: Neighbour; next: Neighbour; noun: string }) {
  return (
    <>
      {previous ? (
        <Link href={previous.href} className={buttonVariants({ variant: "outline" })} title={`Previous ${noun}: ${previous.label}`}>
          <ChevronLeft aria-hidden="true" />
          <span className="max-w-48 truncate">{previous.label}</span>
        </Link>
      ) : (
        <Button variant="outline" disabled title={`No ${noun} before this one`}><ChevronLeft aria-hidden="true" />None before</Button>
      )}
      {next ? (
        <Link href={next.href} className={buttonVariants({ variant: "outline" })} title={`Next ${noun}: ${next.label}`}>
          <span className="max-w-48 truncate">{next.label}</span>
          <ChevronRight aria-hidden="true" />
        </Link>
      ) : (
        <Button variant="outline" disabled title={`No ${noun} after this one`}>None after<ChevronRight aria-hidden="true" /></Button>
      )}
    </>
  );
}

/**
 * The 560px dialog (UI-CONSISTENCY §11 `lg`: a form with two columns or a table) for Confirm and mark paid and the
 * split dialog. Named here because the §5 tall-control ratchet reads any `size="lg"` as a 44px button.
 */
export const WIDE_DIALOG = "lg" as const;
