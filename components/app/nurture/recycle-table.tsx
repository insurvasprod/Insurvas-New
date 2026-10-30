"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputControl } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { NurtureCampaignReport } from "@/lib/nurture/report";
import { ANGLE_MAX, ANGLE_MIN, RECYCLABLE_DISPOSITIONS, SAID_NO_MIN_DAYS } from "@/lib/nurture/contract";
import { count, plural, restDays, ruleSummary, sameRule, draftOf, sourceLine } from "@/components/app/nurture/format";
import { ANGLES, type Progress } from "@/components/app/nurture/recycle-cards";

/**
 * Lead sources › 6 Recycle, board C (LirY3, owner pick 2026-10-29): one row per campaign, then the
 * rule it brings leads back by. A row opens the campaign's panel (bring back with a new angle, its
 * rule editor, its past batches); a row that cannot recycle says why with a fix link into that panel,
 * at the exact control. "Bring back all ready" in the corner asks for one angle for every campaign.
 */

/** Where the panel puts the cursor when a row opens it. */
export type PanelFocus = "angle" | "max" | "wait" | null;

/** Whole percents, as the board reads them ("7% vs 14%"). */
export const wholePercent = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value)}%`);

/**
 * The "Recycled vs fresh" cell (owner critique 2026-10-30: "— vs 0%" read as broken): both rates as
 * "7% vs 14%", one alone with its label ("7% recycled"), and a plain "—" when there is neither.
 */
export function contactCell(contact: NurtureCampaignReport["contact"]) {
  const recycled = contact?.recycled ?? null;
  const fresh = contact?.fresh ?? null;
  if (recycled != null && fresh != null) return `${wholePercent(recycled)} vs ${wholePercent(fresh)}`;
  if (recycled != null) return `${wholePercent(recycled)} recycled`;
  if (fresh != null) return `${wholePercent(fresh)} fresh`;
  return "—";
}

/** The green "→" fix link, a button because it opens the panel in place. */
function Fix({ children, onClick, title }: { children: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" title={title} onClick={(event: MouseEvent) => { event.stopPropagation(); onClick(); }} className="text-right text-xs font-semibold text-[var(--accent-ink)] hover:underline">
      {children} →
    </button>
  );
}

function RowAction({ campaign, readOnly, readOnlyReason, batchesReady, live, onOpen }: {
  campaign: NurtureCampaignReport;
  readOnly: boolean;
  readOnlyReason: string;
  batchesReady: boolean;
  live: Progress | null;
  onOpen: (focus: PanelFocus) => void;
}) {
  if (live) return <StatusChip tone="info">Screening{live.pending ? ` · ${count(live.pending)} to go` : ""}</StatusChip>;
  if (!batchesReady) return <span className="text-xs text-[var(--body)]" title="Batches need a database update that has not been applied yet.">Can&apos;t: needs an update</span>;
  if (campaign.openBatch) return <Fix onClick={() => onOpen(null)}>{campaign.openBatch.stalled ? "Stalled · resume" : "Screening · continue"}</Fix>;
  if (campaign.rule.max_recycles === 0) return <Fix onClick={() => onOpen("max")}>Can&apos;t: the cap is 0</Fix>;
  if (campaign.eligibleNow === 0) {
    return campaign.eligible_count === 0
      ? <span className="text-xs text-[var(--body)]">None in nurture</span>
      : <Fix onClick={() => onOpen(null)}>Can&apos;t: none ready yet</Fix>;
  }
  return (
    <Button type="button" variant="outline" size="sm" disabled={readOnly} title={readOnly ? readOnlyReason : undefined} onClick={(event) => { event.stopPropagation(); onOpen("angle"); }}>
      Bring back
    </Button>
  );
}

export function CampaignTable({ campaigns, total, empty, readOnly, readOnlyReason, batchesReady, progress, onOpen }: {
  /** The campaigns the view and the search leave. */
  campaigns: NurtureCampaignReport[];
  /** Every campaign, so an empty search says so rather than "no campaigns". */
  total: number;
  /** What an empty view says instead, e.g. "With leads" when no campaign has any (with a way to all). */
  empty?: { title: string; hint: string; action?: ReactNode } | null;
  readOnly: boolean;
  readOnlyReason: string;
  batchesReady: boolean;
  progress: Progress | null;
  onOpen: (campaignId: string, focus: PanelFocus) => void;
}) {
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(520, 57);
  const shown = paginate(campaigns, page, pageSize);
  return (
    <TableCard footer={campaigns.length ? <Pager page={shown.current} total={campaigns.length} noun={campaigns.length === 1 ? "campaign" : "campaigns"} pageSize={pageSize} onPage={setPage} /> : undefined}>
      {campaigns.length ? (
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Campaign</TableHead>
              <TableHead className="w-[11%] text-right">In nurture</TableHead>
              <TableHead className="w-[11%] text-right">Ready now</TableHead>
              <TableHead className="w-[16%]">Rule</TableHead>
              <TableHead className="w-[14%]" title="Contact rate this month: the campaign's recycled leads against its fresh ones">Recycled vs fresh</TableHead>
              <TableHead className="w-[18%]"><span className="sr-only">Bring back</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((campaign) => {
              const live = progress?.campaignId === campaign.campaign_id ? progress : null;
              const line = sourceLine(campaign);
              return (
                <TableRow key={campaign.campaign_id} className="cursor-pointer" onClick={() => onOpen(campaign.campaign_id, null)}>
                  <TableCell>
                    <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(campaign.campaign_id, null); }} className="flex max-w-[320px] flex-col text-left leading-[1.3]">
                      <span className="truncate font-semibold text-[var(--ink)]">{campaign.campaign_name}</span>
                      {line && <span className="truncate text-xs text-[var(--body)]">{line}</span>}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{count(campaign.eligible_count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(campaign.eligibleNow)}</TableCell>
                  <TableCell className="!whitespace-normal">{ruleSummary(campaign.rule)}</TableCell>
                  <TableCell className="!whitespace-normal tabular-nums">
                    {contactCell(campaign.contact)}
                  </TableCell>
                  {/* The fix links ("Can't: none ready yet →") wrap inside the column rather than run off the card. */}
                  <TableCell className="!whitespace-normal text-right">
                    <RowAction campaign={campaign} readOnly={readOnly} readOnlyReason={readOnlyReason} batchesReady={batchesReady} live={live} onOpen={(focus) => onOpen(campaign.campaign_id, focus)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : empty ? (
        <EmptyState title={empty.title} hint={empty.hint} action={empty.action} />
      ) : (
        <EmptyState title={total ? "No campaign matches" : "No campaigns yet"} hint={total ? "Try another name." : "Recycling works campaign by campaign. Add one in Source first."} />
      )}
    </TableCard>
  );
}

const NEVER = [["wrong_number", "Wrong number"], ["do_not_call", "Do not call"]] as const;
const OUTCOME_NAME: Record<string, string> = { no_answer: "No answer", voicemail: "Voicemail", not_interested: "Not interested" };

/**
 * "Comes back when": each outcome with when it returns, from a real rule. One rule shared by every
 * campaign reads plain; when rules differ it is the rule of the campaign with the most in nurture,
 * and says so (each campaign's own rule is in its panel).
 */
function referenceRule(campaigns: NurtureCampaignReport[]) {
  const reference = [...campaigns].sort((a, b) => b.eligible_count - a.eligible_count)[0];
  const rule = reference.rule;
  const differ = campaigns.filter((campaign) => !sameRule(draftOf(campaign.rule), rule)).length;
  return { reference, rule, differ, on: rule.max_recycles > 0 };
}

/**
 * The full rule, folded by default (owner 2026-10-30, "make this collapsable"): the header alone
 * stays; it opens to every outcome's chip. (The one-line version under "next up" went the same day.)
 */
export function ComesBackWhen({ campaigns }: { campaigns: NurtureCampaignReport[] }) {
  const [open, setOpen] = useState(false);
  if (!campaigns.length) return null;
  const { reference, rule, differ, on } = referenceRule(campaigns);
  return (
    <Card>
      <CardContent className="flex flex-col">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="comes-back-when-rules"
          className="-mx-2 flex min-h-9 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Comes back when</span>
            {differ > 0 && <span className="text-xs text-[var(--body)]">{reference.campaign_name}&apos;s rule ({ruleSummary(rule)}) · {plural(differ, "campaign has", "campaigns have")} their own</span>}
          </span>
          <span className="shrink-0 text-xs text-[var(--body)]">{open ? "Hide" : "Show rules"}</span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-[var(--body)] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
        {/* Height animates with the grid-rows trick; the rules stay in the DOM, hidden from the reader when shut. */}
        <div id="comes-back-when-rules" aria-hidden={!open} inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 text-sm text-[var(--ink)]">
          {RECYCLABLE_DISPOSITIONS.map((outcome) => {
            const allowed = on && rule.allowed_dispositions.includes(outcome);
            const days = restDays(rule, outcome);
            return (
              <li key={outcome} className="flex items-center justify-between gap-3">
                <span>{OUTCOME_NAME[outcome]}</span>
                {allowed
                  ? <StatusChip tone="good" title={outcome === "not_interested" ? `Only an owner can bring a lead who said no back, ${SAID_NO_MIN_DAYS}+ days after the outcome.` : undefined}>after {plural(days, "day")}{outcome === "not_interested" ? " · owner" : ""}</StatusChip>
                  : <StatusChip tone="neutral" title="Not in this rule. Turn it on in a campaign's rule.">not recycled</StatusChip>}
              </li>
            );
          })}
          {NEVER.map(([key, name]) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <span>{name}</span>
              <StatusChip tone="danger" title="Never recycled, even when added after the first campaign.">never</StatusChip>
            </li>
          ))}
        </ul>
        <span className="text-xs text-[var(--body)]">
          {on ? `At most ${plural(rule.max_recycles, "time")}.` : "The cap is 0, so nothing comes back."} Re-scrubbed every time. Recycled leads go last in the queue.
        </span>
        </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The corner's "Bring back all ready": one angle (required, as for one campaign) for every campaign
 * that can start a batch now; each batch is then started and screened in turn.
 */
export function BringBackAllDialog({ open, onOpenChange, campaigns, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The campaigns that can start now, each with its ready count. */
  campaigns: NurtureCampaignReport[];
  onConfirm: (angle: string) => void;
}) {
  const [angle, setAngle] = useState("");
  const total = campaigns.reduce((sum, campaign) => sum + campaign.eligibleNow, 0);
  const ok = angle.trim().length >= ANGLE_MIN;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Bring {plural(total, "lead")} back?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="recycle-all-angle" className="text-label text-[var(--body)]">The new angle <span className="text-xs">· required</span></label>
          <input id="recycle-all-angle" value={angle} maxLength={ANGLE_MAX} required onChange={(event) => setAngle(event.target.value)} placeholder="What is different this time" className={inputControl} />
          <span className="flex flex-wrap gap-1.5" aria-label="Quick angles" role="group">
            {ANGLES.map((item) => <ToggleChip key={item} selected={angle === item} onClick={() => setAngle(angle === item ? "" : item)}>{item}</ToggleChip>)}
          </span>
          <ul aria-label="Campaigns" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-[var(--ink)]">
            {campaigns.map((campaign) => (
              <li key={campaign.campaign_id} className="flex justify-between gap-3"><span className="truncate">{campaign.campaign_name}</span><span className="tabular-nums">{count(campaign.eligibleNow)}</span></li>
            ))}
          </ul>
          <span className="text-xs text-[var(--body)]">Every lead is screened against do-not-call and suppression again before it can be dialled. Each campaign gets its own batch, and a batch keeps its progress if you close the tab.</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!ok} title={ok ? undefined : "Write the new angle first"} onClick={() => { onConfirm(angle.trim()); setAngle(""); }}>Scrub and bring back</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
