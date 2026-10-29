"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { LeadListAssignDrawer, prefetchListPreview, type AssignDrawerMember } from "@/components/app/lead-list-assign-drawer";
import { LeadListClaimButton } from "@/components/app/lead-list-claim-button";
import { ConsentCard, ListEconomics, ListHealthCard, MappingCard, PoolBlockersCard, RemovalsCard, listFigures, listMoney, listSubtitle } from "@/components/app/lead-list-detail";
import { ListStateChip, type LeadListIndexRow, type LeadListPanelIntent, type LeadListPanelTab } from "@/components/app/lead-list-index";
import { LeadListScrub } from "@/components/app/lead-list-scrub";
import { useSolo } from "@/components/app/solo-context";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { TableCard } from "@/components/ui/table-card";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { LeadListDetail } from "@/lib/leadLists/detail";

/**
 * One bought list, opened in place on Lead sources › Lists (owner 2026-10-29: "for all of the
 * functionalities that redirect to another page, can we make them work in this page?"). A wide
 * sheet over the index with the list's own page (/app/lead-lists/[campaignId], which stays) as four
 * sections, built from that page's own parts (lead-list-detail.tsx) and read through the same gates
 * (GET /api/app/lead-lists?campaign_id=&detail=1):
 *
 *   Overview            economics, the scrub (run here), why leads are not served, list health
 *   Leads               assign the pool remainder (the assign drawer), or pick leads one by one
 *   Removed & claims    what the scrub removed, the claim draft, the claimable rows' export
 *   Mapping & consent   the vendor's saved column map and the consent proof
 *
 * Portalled to <body>: a transformed ancestor (the Leads frame's ribbon) would pin a fixed panel to
 * itself instead of the window.
 */

export const PANEL_TABS: readonly LeadListPanelTab[] = ["overview", "leads", "removed", "columns"];

type PanelData = {
  detail: LeadListDetail;
  money: boolean;
  /** May this person see what the list cost (owner, producer)? */
  spend?: boolean;
  timeZone: string | null;
  assign: { manager: boolean; blocked: string | null };
  claimBlocked: string | null;
  /** May this person export the leads with no consent certificate (the consent locker is on)? */
  consentExport?: boolean;
};

const count = (value: number) => value.toLocaleString("en-US");

export function LeadListPanel({ list, nowAt, tab, intent, onTab, onClose, onChanged, canScrub, leads, members = null }: {
  list: LeadListIndexRow;
  nowAt: number;
  tab: LeadListPanelTab;
  /** What the row's button asked for: the assign drawer open, or the scrub started. */
  intent: LeadListPanelIntent;
  onTab: (tab: LeadListPanelTab) => void;
  onClose: () => void;
  /** Something here changed the list (assigned, claimed, scrubbed): the index reloads. */
  onChanged: () => Promise<unknown> | void;
  /** May this person reach the scrub (owner / producer on Outbound dialing)? Only an owner runs one. */
  canScrub: boolean;
  /** The Leads tab's per-lead picker (lead-list-workspace), told how to reload this panel. */
  leads: (reloadPanel: () => Promise<void>) => ReactNode;
  /** Who can take leads and how full each is, as the Lists step already read it: the assign drawer's roster. */
  members?: AssignDrawerMember[] | null;
}) {
  // Solo mode (owner 2026-10-29): nobody to hand leads to, so no assign drawer and no "has an owner" line.
  const solo = useSolo();
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/app/lead-lists?${new URLSearchParams({ campaign_id: list.campaignId, detail: "1" })}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load this list");
      setData(body as PanelData);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this list");
    } finally {
      setRefreshing(false);
    }
  }, [list.campaignId]);

  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  // A row's "Assign" starts the rule-chain preview now, alongside this panel's own read, instead of
  // after it (2026-10-29 speed pass): the drawer then opens on a finished answer.
  useEffect(() => { if (intent === "assign" && !solo) void prefetchListPreview(list.campaignId); }, [intent, list.campaignId, solo]);

  /** After a change made here: this panel and the index both read again. */
  const changed = useCallback(async () => { await Promise.all([load(), onChanged()]); }, [load, onChanged]);

  const d = data?.detail ?? null;
  const figures = d ? listFigures(d) : null;
  const assign = solo ? { manager: false, blocked: null } : data?.assign ?? { manager: false, blocked: null };
  const tabs = [
    { key: "overview" as const, label: "Overview" },
    { key: "leads" as const, label: "Leads", count: d ? Math.max(0, d.leadsReceived - d.assigned) : list.untouched },
    { key: "removed" as const, label: "Removed & claims", count: figures?.removed ?? null },
    { key: "columns" as const, label: "Mapping & consent" },
  ];
  // The row's intent starts its action when the drawer or the scrub first mounts. Changing tab clears
  // it (lead-list-workspace), so coming back to a tab does not start it again; a reload keeps the
  // section mounted, so it does not either.

  let body: ReactNode;
  if (!d || !data) {
    body = error
      ? <TableCard><ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} /></TableCard>
      : <TableCard><SectionLoading rows={6} columns={4} label="Loading this list" /></TableCard>;
  } else if (tab === "overview") {
    const unscrubbed = d.scrubStatus !== "scrubbed";
    body = (
      <>
        <ListEconomics detail={d} money={data.money} spend={data.spend ?? true} />
        {canScrub && unscrubbed && (
          <TableCard title="Scrub">
            <div className="border-t border-border px-4 py-3">
              <LeadListScrub campaignId={d.campaignId} campaignName={d.campaignName} autoStart={intent === "scrub"} onDone={() => void changed()} />
            </div>
          </TableCard>
        )}
        {d.poolBlockers && d.poolBlockers.total > 0 && (
          <PoolBlockersCard pool={d.poolBlockers} scrubFix={canScrub && unscrubbed ? <span className="text-xs text-[var(--muted)]">Run the scrub above, in this panel.</span> : null} />
        )}
        <ListHealthCard detail={d} />
      </>
    );
  } else if (tab === "leads") {
    body = (
      <>
        {/* Owners and producers move the whole pool remainder at once in the drawer (by the rules, or
            picked in place); everyone picks leads one by one below. */}
        {assign.manager && d.assignable > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {assign.blocked ? (
              <>
                <Button type="button" disabled aria-describedby="panel-assign-blocked">Assign the {count(d.assignable)}</Button>
                <span id="panel-assign-blocked" role="status" className="text-sm text-[var(--warning-ink)]">{assign.blocked}</span>
              </>
            ) : (
              <LeadListAssignDrawer
                campaignId={d.campaignId}
                listName={d.campaignName}
                assignable={d.assignable}
                defaultOpen={intent === "assign"}
                onDone={() => void changed()}
                members={members}
                picker={leads(load)}
              />
            )}
            <span className="text-sm text-[var(--body)]">{count(d.assignable)} usable {d.assignable === 1 ? "lead is" : "leads are"} in the pool with no owner.</span>
          </div>
        )}
        {assign.manager && d.assignable === 0 && d.leadsReceived > 0 && (
          // Nothing left for the drawer to move: said once, with where the leads are.
          <p role="status" className="text-sm text-[var(--body)]">Every usable lead in this list has an owner. Pick one below to move it.</p>
        )}
        <div id="lead-list-panel-leads">{leads(load)}</div>
      </>
    );
  } else if (tab === "removed") {
    // Every reason has its own Claim credit and Export in the table; "Claim all" stays for a list with
    // more than one reason to claim, so it is one press, not one per row.
    const claimReasons = d.removals.filter((row) => row.unclaimedRows > 0).length;
    const claimAll = data.money && d.claims.supported && d.claims.unclaimedRows > 0 && claimReasons > 1 && (figures?.windowOpen ?? true);
    body = (
      <>
        {claimAll && (
          <div className="flex flex-wrap items-start justify-end gap-2">
            {figures && (figures.claimableRows ?? 0) > 0 && (
              <Button asChild type="button" variant="outline">
                <a href={figures.exportHref} download>Export all claimable</a>
              </Button>
            )}
            <LeadListClaimButton campaignId={d.campaignId} rows={d.claims.unclaimedRows} amount={listMoney(d.claims.unclaimedCents)} blocked={data.claimBlocked} onDone={() => void changed()} />
          </div>
        )}
        <RemovalsCard detail={d} money={data.money} claim={{ blocked: data.claimBlocked, onDone: () => void changed() }} />
      </>
    );
  } else {
    body = (
      <>
        <MappingCard detail={d} />
        <ConsentCard
          detail={d}
          timeZone={data.timeZone}
          exportHref={data.consentExport ? `/api/app/lead-lists?${new URLSearchParams({ campaign_id: d.campaignId, export: "consent_missing" })}` : null}
        />
      </>
    );
  }

  return createPortal(
    <Sheet
      title={list.campaignName}
      subtitle={d ? listSubtitle(d, data?.timeZone ?? null, data?.spend ?? true) : list.vendorName}
      status={<ListStateChip list={list} nowAt={nowAt} />}
      actions={<RefreshButton onClick={() => void load()} refreshing={refreshing} />}
      onClose={onClose}
      closeLabel={`Close ${list.campaignName}`}
      className="lg:w-[min(960px,70vw)]"
      bodyClassName="flex flex-col"
    >
      <UnderlineTabs
        label={`${list.campaignName} sections`}
        tabs={tabs}
        value={tab}
        onChange={onTab}
        idPrefix="lead-list-panel-tab"
        controls="lead-list-panel-body"
        className="sticky top-0 z-10 shrink-0 bg-card px-4"
      />
      <div id="lead-list-panel-body" role="tabpanel" aria-labelledby={`lead-list-panel-tab-${tab}`} className="flex flex-col gap-4 p-4">
        {body}
      </div>
    </Sheet>,
    document.body,
  );
}
