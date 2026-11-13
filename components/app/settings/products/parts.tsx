"use client";

/**
 * Settings › Products, round 8 (board settings-r8/products-and-ai, P1–P4): the pieces the page and its sheet
 * share. The row's "What it needs" is neutral text — a done step in the body colour with a tick, a missing one
 * on a product you sell a green "+" link to the page that sets it up, anything else a quiet dash — so the only
 * colour on a row is its one Ready chip (one-line tables rule, owner 2026-11-11).
 */

import Link from "next/link";

import type { Need } from "@/lib/products/readiness";
import { cn } from "@/lib/utils";

export type ProductRow = {
  code: string;
  name: string;
  category: string;
  inPlan: boolean;
  enabled: boolean;
  sold: boolean;
  partners: string[];
  formReady: boolean;
  carriers: number;
};

export const CATEGORY_LABEL: Record<string, string> = { life: "Life", health: "Health", retirement: "Retirement" };
export const CATEGORY_ORDER = ["life", "health", "retirement"];

export const lineOf = (category: string) => CATEGORY_LABEL[category] ?? category.charAt(0).toUpperCase() + category.slice(1);

/** Today's wording (2026-10-27), kept for the stop-selling dialog. */
export function partnersText(partners: string[]) {
  if (partners.length === 0) return "No partner may send it yet";
  if (partners.length <= 2) return `${partners.join(" and ")} may send it`;
  return `${partners.slice(0, 2).join(", ")} and ${partners.length - 2} more may send it`;
}

/** The table's partners cell: "SmartFinancial, Datalot + 2". */
export function partnersShort(row: ProductRow) {
  if (!row.sold && !row.partners.length) return "—";
  if (!row.partners.length) return "No partner yet";
  return row.partners.length <= 2 ? row.partners.join(", ") : `${row.partners.slice(0, 2).join(", ")} + ${row.partners.length - 2}`;
}

const LINK = "font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

/** One need in the row: "✓ Form", "+ Quote inputs" (a link), "— Health questions", "n/a Health questions". */
function NeedWord({ need, sold }: { need: Need; sold: boolean }) {
  if (need.state === "done") return <span className="whitespace-nowrap text-[var(--body)]"><span aria-hidden>✓ </span><span className="sr-only">Has </span>{need.short}</span>;
  if (need.state === "na") return <span className="whitespace-nowrap text-[var(--muted)]">n/a {need.short}</span>;
  if (sold) {
    return (
      <Link href={need.href} onClick={(event) => event.stopPropagation()} className={cn("whitespace-nowrap", LINK)}>
        <span aria-hidden>+ </span><span className="sr-only">Set up </span>{need.short}
      </Link>
    );
  }
  return <span className="whitespace-nowrap text-[var(--muted)]"><span aria-hidden>— </span><span className="sr-only">No </span>{need.short}</span>;
}

export function NeedsLine({ needs, sold }: { needs: Need[] | null; sold: boolean }) {
  if (!needs) return <span aria-hidden className="block h-3 w-48 max-w-full animate-pulse rounded bg-[var(--surface-alt)]" />;
  return (
    <span className="flex min-w-0 items-center gap-x-3 overflow-hidden text-sm">
      {needs.map((need) => <NeedWord key={need.key} need={need} sold={sold} />)}
    </span>
  );
}

export const linkClass = LINK;
