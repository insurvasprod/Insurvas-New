"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import { FACET_STATE_LABEL, type FacetCell, type FacetState } from "@/lib/carriers/setup";

const DOT: Record<Exclude<FacetState, "unknown">, string> = {
  set: "bg-[var(--success)]",
  waiting: "bg-[var(--warning)]",
  missing: "border-[1.5px] border-[var(--muted)] bg-transparent",
};

/**
 * One facet of a carrier's set-up as a dot (admin round 1, catalog.html screens 7–8): filled green when it is set up,
 * filled amber when it is partly set up or waits for a review, an empty ring when it is missing, a dash when it could
 * not be read. The state is in the accessible name and the hover, never in the colour alone. With `href` the dot
 * opens that part of the carrier's record.
 */
export function CarrierSetupDot({ cell, label, href, showCount = false }: { cell: FacetCell; label: string; href?: string; showCount?: boolean }) {
  const name = `${label}: ${FACET_STATE_LABEL[cell.state]}. ${cell.detail}`;
  const mark = cell.state === "unknown"
    ? <span className="text-muted-foreground" aria-hidden="true">—</span>
    : showCount && cell.count
      ? <span className="font-semibold tabular-nums text-foreground" aria-hidden="true">{cell.count.toLocaleString("en-US")}</span>
      : showCount && cell.state === "set"
        ? <span className="text-muted-foreground" aria-hidden="true">—</span>
        : <span className={cn("inline-block size-2.5 rounded-full", DOT[cell.state])} aria-hidden="true" />;
  if (!href) return <span className="inline-flex size-6 items-center justify-center" title={name} role="img" aria-label={name}>{mark}</span>;
  return (
    <Link href={href} title={name} aria-label={`${name} Open it.`} onClick={(event) => event.stopPropagation()} className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring-color)]">
      {mark}
    </Link>
  );
}

/** The key under a table of dots. */
export function CarrierSetupLegend() {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block size-2.5 rounded-full", DOT.set)} aria-hidden="true" />set up</span>
      <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block size-2.5 rounded-full", DOT.waiting)} aria-hidden="true" />partly set up or waiting for review</span>
      <span className="inline-flex items-center gap-1.5"><span className={cn("inline-block size-2.5 rounded-full", DOT.missing)} aria-hidden="true" />missing</span>
      <span>Each dot opens that part of the carrier&apos;s record.</span>
    </p>
  );
}
