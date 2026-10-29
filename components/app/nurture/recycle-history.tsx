"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import type { NurtureReport, RotationSlot } from "@/lib/nurture/report";
import type { RecycleBatch } from "@/lib/nurture/contract";
import { cn } from "@/lib/utils";
import { count, label, money, percent, plural, stamp } from "@/components/app/nurture/format";

/**
 * The Recycle step's history and cadence (redesign 2026-10-29): the compact past-batches table and
 * a batch's sheet; fresh against recycled (the Compare dialog); the retry cadence and slot rotation
 * (the Cadence dialog, opened from the top row).
 */

const SLOT_HOURS: Record<string, string> = { early_morning: "8–10am", late_morning: "10am–12", afternoon: "12–3pm", early_evening: "3–6pm", late_evening: "6–9pm", weekend: "Weekend" };
const PREFERRED: Record<string, string> = { opposite_half: "the other half of the day", morning: "a morning slot", evening: "an evening slot", early_morning: "early morning", late_morning: "late morning", afternoon: "the afternoon", early_evening: "early evening", late_evening: "late evening", weekend: "the weekend" };

function offset(ms: number) {
  if (ms === 0) return "day 0";
  const hours = Math.round(ms / 3_600_000);
  return hours < 48 ? `${hours}h after the first dial` : `day ${Math.round(hours / 24)}`;
}

/** This month's fresh and recycled leads side by side, and conversion all time (moved from Activity, 2026-10-26). */
export function FreshVsRecycled({ data }: { data: NurtureReport }) {
  const rows = (["fresh", "recycled"] as const).map((source) => ({ source, row: data.sources.find((item) => item.source === source) ?? null, conversion: data.conversion?.[source] ?? null }));
  if (!data.sources.length && !data.conversion) return null;
  return (
    <TableCard title="Fresh vs recycled" description="Served, dialled and contacts this month · policies all time">
      <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
        <thead><tr><th scope="col">Source</th><th scope="col" className="text-right">Served</th><th scope="col" className="text-right">Dialled</th><th scope="col" className="text-right">Contacts</th><th scope="col" className="text-right">Contact rate</th><th scope="col" className="text-right">Policies per 100 worked</th></tr></thead>
        <tbody>
          {rows.map(({ source, row, conversion }) => (
            <tr key={source}>
              <td className="font-medium">{label(source)}</td>
              <td className="text-right tabular-nums">{row ? count(row.served) : "—"}</td>
              <td className="text-right tabular-nums">{row ? count(row.dialled) : "—"}</td>
              <td className="text-right tabular-nums">{row ? count(row.contacts) : "—"}</td>
              <td className="text-right tabular-nums">{percent(row?.contactRate ?? null)}</td>
              <td className="text-right tabular-nums" title={conversion ? `${plural(conversion.policies, "policy", "policies")} from ${count(conversion.leads)} leads` : undefined}>{percent(conversion?.percent ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

const PAGE_SIZE = 5;

/**
 * The past batches, compact: this campaign's or every campaign's, five a page, each opening its
 * details in a sheet. Hidden while no batch has run (the owner's rule: no empty figures).
 */
export function BatchTable({ batches, baseline, campaignId, onOpen, onCompare }: {
  batches: RecycleBatch[];
  baseline: number | null;
  campaignId: string;
  onOpen: (batch: RecycleBatch) => void;
  /** Fresh against recycled in full; omitted when there is nothing to compare. */
  onCompare?: () => void;
}) {
  const mine = batches.filter((batch) => batch.campaignId === campaignId);
  const [scope, setScope] = useState<"campaign" | "all">(mine.length ? "campaign" : "all");
  const [page, setPage] = useState(1);
  const shown = scope === "campaign" ? mine : batches;
  const { current, rows } = paginate(shown, page, PAGE_SIZE);
  if (!batches.length) return null;
  return (
    <TableCard
      title="Past batches"
      description={baseline == null ? undefined : `Contact rate against ${percent(baseline)} for fresh leads over the same span`}
      action={
        <>
          <Segmented label="Which batches" value={scope} onChange={(next) => { setScope(next); setPage(1); }} options={[{ key: "campaign", label: "This campaign", count: mine.length }, { key: "all", label: "All", count: batches.length }]} />
          {onCompare && <Button type="button" variant="outline" onClick={onCompare}>Fresh vs recycled</Button>}
        </>
      }
      footer={shown.length > PAGE_SIZE ? <Pager page={current} total={shown.length} noun="batches" pageSize={PAGE_SIZE} onPage={setPage} /> : undefined}
    >
      {shown.length ? (
        <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col">Angle</th>
              {scope === "all" && <th scope="col" className="w-[160px]">Campaign</th>}
              <th scope="col" className="w-[120px]">Started</th>
              <th scope="col" className="w-[80px] text-right">Cleared</th>
              <th scope="col" className="w-[70px] text-right">Rate</th>
              <th scope="col" className="w-[76px] text-right">Policies</th>
              <th scope="col" className="w-[72px]"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((batch) => {
              const better = batch.contactRate != null && baseline != null ? batch.contactRate >= baseline : null;
              return (
                <tr key={batch.id} className="m-row">
                  <td className="max-w-[260px]"><span className="block truncate font-semibold" title={batch.angle}>{batch.angle}</span></td>
                  {scope === "all" && <td className="max-w-[160px] truncate" title={batch.campaignName}>{batch.campaignName}</td>}
                  <td className="whitespace-nowrap">{batch.status === "screening" ? <StatusChip tone="warning">Screening</StatusChip> : <span className="text-muted-foreground">{stamp(batch.createdAt)}</span>}</td>
                  <td className="text-right tabular-nums">{count(batch.cleared)}</td>
                  <td className={cn("text-right font-semibold tabular-nums", better === true && "text-[var(--success-ink)]", better === false && "text-[var(--error-ink)]")}>{percent(batch.contactRate)}</td>
                  <td className="text-right tabular-nums">{count(batch.policies)}</td>
                  <td className="text-right"><Button type="button" variant="ghost" size="sm" aria-label={`Open the batch “${batch.angle}”`} onClick={() => onOpen(batch)}>Open</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState title="No batch for this campaign yet" hint="Bring its ready leads back to start one, or show every campaign's batches." />
      )}
    </TableCard>
  );
}

/** One batch, every figure the report holds, in a sheet. */
export function BatchSheet({ batch, baseline, onClose }: { batch: RecycleBatch; baseline: number | null; onClose: () => void }) {
  const facts: Array<[string, string]> = [
    ["Started by", batch.createdByName ?? "A teammate"],
    ["Started", stamp(batch.createdAt)],
    ...(batch.completedAt ? [["Finished", stamp(batch.completedAt)] as [string, string]] : []),
    ["Dials per lead this pass", String(batch.attemptCeiling)],
    ["Queued", count(batch.queued)],
    ["Cleared and back in the dialer", count(batch.cleared)],
    ["Blocked on re-screening", count(batch.blocked)],
    ["Held (screening did not answer)", count(batch.failed)],
    ...(batch.pending ? [["Waiting to be screened", count(batch.pending)] as [string, string]] : []),
    ["Left out as too recent", count(batch.excludedTooRecent)],
    ["Said no", count(batch.saidNo)],
    ["Dials", count(batch.dials)],
    ["Contacts", count(batch.contacts)],
    ["Leads reached", count(batch.leadsReached)],
    ...(batch.contactRate != null ? [["Contact rate", `${percent(batch.contactRate)}${baseline == null ? "" : ` · fresh ${percent(baseline)}`}`] as [string, string]] : []),
    ["Policies", count(batch.policies)],
    ["New spend", money(batch.costCents)],
  ];
  return (
    <Sheet
      title={batch.angle}
      subtitle={batch.campaignName}
      status={<StatusChip tone={batch.status === "screening" ? "warning" : "good"}>{batch.status === "screening" ? (batch.stalled ? "Stalled" : "Screening") : "Complete"}</StatusChip>}
      onClose={onClose}
      closeLabel="Close the batch"
    >
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        {facts.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-[var(--body)]">{name}</dt>
            <dd className="m-0 text-right font-semibold tabular-nums text-[var(--ink)]">{value}</dd>
          </div>
        ))}
      </dl>
      {batch.script && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-[var(--body)]">Script</span>
          <p className="m-0 whitespace-pre-wrap text-sm text-[var(--ink)]">{batch.script}</p>
        </div>
      )}
    </Sheet>
  );
}

const SLOT_LOOK: Record<RotationSlot["state"], string> = {
  failed: "border-[var(--error)] bg-[var(--error-surface)] [&>div:first-child]:text-[var(--error-ink)]",
  answered: "border-[var(--success)] bg-[var(--success-surface)] [&>div:first-child]:text-[var(--success-ink)]",
  next: "border-[var(--primary)] bg-[var(--primary-soft)] [&>div:first-child]:text-[var(--accent-ink)]",
  untried: "border-border bg-card [&>div:first-child]:text-[var(--body)]",
};

/** The retry cadence the dialer walks, and one real lead's slot rotation. */
export function RecycleCadence({ cadence, rotation }: { cadence: NurtureReport["cadence"]; rotation: NurtureReport["rotation"] }) {
  return (
    <div className="flex flex-col gap-4">
      <TableCard
        className="min-w-0"
        title="Retry cadence"
        action={
          <>
            {cadence && <StatusChip tone="action" dot={false}>{cadence.first72} of {cadence.total} inside 72 hours</StatusChip>}
            <Button asChild variant="outline"><Link href="/app/settings#cadence">Edit cadence</Link></Button>
          </>
        }
        footer={cadence?.usingDefaults ? "No cadence is saved, so this is the dialer's built-in schedule." : undefined}
      >
        {cadence ? (
          <table className="portal-lead-table w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-[80px]">Attempt</th>
                <th scope="col" className="w-[130px]">Wait</th>
                <th scope="col" className="w-[220px]">Slot</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {cadence.steps.map((step) => (
                <tr key={step.attempt} className={cn("m-row", step.offsetMs <= 72 * 3_600_000 && "bg-[var(--primary-soft)]")}>
                  <td className="tabular-nums font-semibold">{step.attempt}</td>
                  <td className="tabular-nums">{step.interval ? `+${step.interval}` : "immediately"}</td>
                  <td>{step.attempt === 1 ? "on import" : step.slot ? PREFERRED[step.slot] ?? step.slot : "a slot not yet tried"}</td>
                  <td className="text-muted-foreground">{offset(step.offsetMs)}{step.attempt === cadence.total ? " · then exhausted" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">The cadence could not be read.</p>
        )}
      </TableCard>

      <TableCard
        className="w-full"
        title="Slot rotation"
        description={rotation ? undefined : "No lead is mid-cadence right now"}
        action={rotation ? <span className="text-sm text-muted-foreground"><Link href={`/app/leads/${rotation.leadId}`} className="font-semibold text-foreground hover:underline">{rotation.leadName}</Link> · attempt {rotation.attempt} of {rotation.ceiling}</span> : undefined}
      >
        {rotation && (
          <div className="grid grid-cols-3 gap-1.5 border-t border-border p-4 sm:grid-cols-6">
            {rotation.slots.map((slot) => (
              <div key={slot.slot} className={cn("rounded-lg border px-2 py-2.5 text-center", SLOT_LOOK[slot.state])}>
                <div className="text-xs font-semibold">{SLOT_HOURS[slot.slot] ?? slot.slot}</div>
                <div className="mt-1 text-xs text-muted-foreground">{slot.note}</div>
              </div>
            ))}
          </div>
        )}
      </TableCard>
    </div>
  );
}
