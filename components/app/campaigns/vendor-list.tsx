"use client";

import { useState } from "react";
import { Layers, ShieldAlert } from "lucide-react";

import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { StatusChip } from "@/components/ui/status-chip";
import { LEAD_TYPE, money, VendorSignals, type RosterRollup, type RosterVendor } from "@/components/app/vendor-roster";
import { costTone, toneText } from "@/components/app/campaigns/tones";
import { cn } from "@/lib/utils";
import type { VendorCardsResponse } from "@/lib/vendors/types";

/**
 * A · Vendor first (owner pick, 2026-10-28; /ui-taste critique 2026-10-29): the vendors down the
 * left, each with its type, how many campaigns it has, its cost per usable lead (coloured against
 * the agency's cost per dialable lead, or "new" before it has one) and its signals as icons whose
 * names are their tooltips. Vendors that need something come first. "All campaigns" on top shows
 * every vendor's campaigns. The list scrolls inside itself, so the page stays one screen tall.
 */
export function VendorList({ vendors, rollup, facts, selected, onSelect, campaignCount, needsScrub, usableReference, className }: {
  className?: string;
  vendors: RosterVendor[];
  rollup: RosterRollup[];
  facts: VendorCardsResponse | null;
  /** A vendor id, or "all". */
  selected: string;
  onSelect: (vendorId: string) => void;
  campaignCount: number;
  /** Vendors with a campaign whose list is in but not scrubbed. */
  needsScrub: ReadonlySet<string>;
  /** The agency's cost per dialable lead, the reference each vendor's cost per usable lead is coloured against. */
  usableReference: number | null;
}) {
  const [search, setSearch] = useState("");
  const rollupById = new Map(rollup.map((row) => [row.vendor_id, row]));
  const factsById = new Map((facts?.cards ?? []).map((row) => [row.vendor_id, row]));
  const needle = search.trim().toLowerCase();
  // Needing attention first (facts to weigh, money to claim, a scrub, a review), then buying, then
  // the rest; inactive last. Alphabetical inside each.
  const rank = (vendor: RosterVendor) => {
    if (vendor.status === "inactive") return 3;
    const fact = factsById.get(vendor.id);
    if (fact?.drop || fact?.claimable || needsScrub.has(vendor.id) || vendor.status === "under_review") return 0;
    return (rollupById.get(vendor.id)?.active_campaign_count ?? 0) > 0 ? 1 : 2;
  };
  const shown = vendors
    .filter((vendor) => !needle || vendor.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const item = (on: boolean) => cn(
    "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
    on ? "border-[var(--border-strong)] bg-[var(--primary-soft)]" : "border-transparent hover:bg-[var(--surface-alt)]",
  );

  return <nav aria-label="Vendors" className={cn("m-glass flex min-h-0 flex-col overflow-hidden rounded-lg border border-border", className)}>
    <div className="flex-none border-b border-border p-2">
      <ToolbarSearch value={search} onChange={setSearch} placeholder="Search vendors" className="sm:w-full" />
    </div>
    <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-2">
      <li>
        <button type="button" className={item(selected === "all")} aria-current={selected === "all" ? "true" : undefined} onClick={() => onSelect("all")}>
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Layers className="size-4 text-[var(--muted)]" aria-hidden="true" />All campaigns<span className="ml-auto text-xs font-normal tabular-nums text-[var(--muted)]">{campaignCount}</span></span>
        </button>
      </li>
      {shown.map((vendor) => {
        const row = rollupById.get(vendor.id);
        const fact = factsById.get(vendor.id);
        const on = selected === vendor.id;
        const perUsable = row?.cost_per_usable_record_cents ?? null;
        const scrub = needsScrub.has(vendor.id);
        return <li key={vendor.id}>
          <button type="button" className={item(on)} aria-current={on ? "true" : undefined} onClick={() => onSelect(vendor.id)}>
            <span className="flex min-w-0 items-start gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold text-[var(--ink)]" title={vendor.name}>{vendor.name}</span>
              {perUsable === null
                ? <span className="shrink-0 text-xs text-[var(--muted)]" title="No usable leads costed yet">new</span>
                : <span className={cn("shrink-0 text-sm tabular-nums text-[var(--body)]", toneText(costTone(perUsable, usableReference)))} title="Cost per usable lead, after the scrub">{money(perUsable)}</span>}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted)]">
              <span className="min-w-0 flex-1 truncate">{LEAD_TYPE[vendor.lead_type] ?? vendor.lead_type} · {row ? `${row.active_campaign_count}/${row.campaign_count} active` : "0 campaigns"}</span>
              <span className="flex items-center gap-1">
                {scrub && <StatusChip tone="warning" dot={false} title="Needs scrub: a campaign's list is in but not screened"><ShieldAlert className="size-3" aria-hidden="true" /><span className="sr-only">Needs scrub</span></StatusChip>}
                <VendorSignals vendorId={vendor.id} status={vendor.status} fact={fact} compact />
              </span>
            </span>
          </button>
        </li>;
      })}
      {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">No vendor matches.</li>}
    </ul>
  </nav>;
}
