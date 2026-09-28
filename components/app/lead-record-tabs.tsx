"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadRecord, RecordCallback } from "@/lib/leadWorkspace/record";
import { MONTHS, clockTime, weekdayDayMonth, zonedParts } from "@/lib/format/dates";

/**
 * The lead's Attempts, Callbacks and Nurture tabs (p-lead-attempts, p-lead-callbacks,
 * p-lead-nurture). Each reads `/api/app/leads/:id/record` when it opens: the lead page itself
 * stays one request, and a lead with forty dials costs only the agent who asked to see them.
 *
 * The boards draw these flush with the tab card — a table straight under the tab strip, the facts
 * and notes padded around it — so they render without the padded wrapper the other tabs sit in.
 */
function useLeadRecord(leadId: string) {
  const [record, setRecord] = useState<LeadRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}/record`, { cache: "no-store" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok) { setError(body?.error ?? "This lead's record could not be loaded."); return; }
    setRecord(body as LeadRecord);
  }, [leadId]);
  useEffect(() => {
    let cancelled = false;
    void (async () => { await Promise.resolve(); if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);
  return { record, error, reload: load };
}

function Loading({ record, error, reload, children }: { record: LeadRecord | null; error: string | null; reload: () => Promise<void>; children: (record: LeadRecord) => ReactNode }) {
  if (error) return <div className="p-5"><ErrorState title="The record did not load" detail={error} action={<Button type="button" variant="outline" onClick={() => void reload()}>Try again</Button>} /></div>;
  if (!record) return <SectionLoading rows={4} />;
  return <>{children(record)}</>;
}

// ── time, in the zone the reader thinks in ────────────────────────────────────────────────────────

function parts(iso: string, zone: string, extra: Intl.DateTimeFormatOptions = {}) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true, ...extra });
  return Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value])) as Record<string, string>;
}
/** "18 Sep 4:12 pm" */
function stamp(iso: string, zone: string) {
  const p = zonedParts(iso, zone);
  if (!p) return "—";
  return `${p.day} ${MONTHS[p.month - 1]} ${clockTime(iso, zone, "12h").toLowerCase()}`;
}
/** "CT", "MST" — the generic name where the browser has one, so a date in March and one in July read the same. */
function zoneShort(zone: string, iso = new Date().toISOString()) {
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  try { return parts(iso, zone, { timeZoneName: "shortGeneric" }).timeZoneName ?? zone; } catch { return parts(iso, zone, { timeZoneName: "short" }).timeZoneName ?? zone; }
}
/** "America/Chicago · CT"; just "UTC" where the name is the abbreviation. */
function zoneLabel(zone: string) {
  const short = zoneShort(zone);
  return short === zone ? zone : `${zone} · ${short}`;
}
/** "Thu 25 Sep, 2:30 pm CT" */
function askedFor(iso: string, zone: string) {
  if (!zonedParts(iso, zone)) return "—";
  return `${weekdayDayMonth(iso, zone)}, ${clockTime(iso, zone, "12h").toLowerCase()} ${zoneShort(zone, iso)}`;
}
/** "12:30 pm MST" */
function clockIn(iso: string, zone: string) {
  const p = parts(iso, zone);
  return `${p.hour}:${p.minute} ${p.dayPeriod?.toLowerCase() ?? ""} ${zoneShort(zone, iso)}`;
}
function offsetMinutes(zone: string, at = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => Number(p.find((part) => part.type === type)?.value ?? 0);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes())) / 60_000;
}
/** "2 hours ahead of you", "30 minutes behind you", "Same as yours" — today's, since DST moves it. */
function difference(customer: string, agent: string) {
  const minutes = offsetMinutes(customer) - offsetMinutes(agent);
  if (minutes === 0) return "Same as yours";
  const size = Math.abs(minutes);
  const amount = size % 60 === 0 ? `${size / 60} hour${size === 60 ? "" : "s"}` : size < 60 ? `${size} minutes` : `${(size / 60).toFixed(1)} hours`;
  return `${amount} ${minutes > 0 ? "ahead of" : "behind"} you`;
}
function hourClock(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`;
}

// ── shared pieces, drawn the way the boards draw them ────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

const cell = "px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] whitespace-normal";
const head = "h-auto bg-[var(--surface-alt)] px-3 py-2";

// ── Attempts ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every dial on this lead, what screening said before it, and what came back — and the dials
 * screening refused, which carry no number because they were never placed. The board's Length
 * column is the one thing left out: calls leave through the agent's own phone, so nothing here
 * times them, and a guessed talk time is the figure LA-2.9 forbids. Whether the number was clicked
 * is shown in its place, because that is what the product does record about the call itself.
 */
export function LeadAttemptsTab({ leadId }: { leadId: string }) {
  const state = useLeadRecord(leadId);
  return (
    <Loading {...state}>
      {(record) => (
        <div>
          {record.attempts.length === 0 ? (
            <p className="px-5 py-6 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">No dial has been placed or refused on this lead yet.</p>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={`${head} w-[60px]`}>#</TableHead>
                  <TableHead className={`${head} w-[190px]`}>When</TableHead>
                  <TableHead className={`${head} w-[150px]`}>By</TableHead>
                  <TableHead className={`${head} w-[130px]`}>Screening</TableHead>
                  <TableHead className={head}>Outcome</TableHead>
                  <TableHead className={`${head} w-[150px] text-right`}>Number clicked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.attempts.map((attempt) => (
                  <TableRow key={attempt.id} className="m-row">
                    <TableCell className={`${cell} tabular-nums`}>{attempt.number ?? "—"}</TableCell>
                    <TableCell className={`${cell} tabular-nums`}>{stamp(attempt.at, record.zones.agent)}</TableCell>
                    <TableCell className={cell}>{attempt.by}</TableCell>
                    <TableCell className={cell}>{attempt.screening === "passed" ? <StatusChip tone="good" dot={false}>Passed</StatusChip> : <StatusChip tone="danger" dot={false}>Refused</StatusChip>}</TableCell>
                    <TableCell className={cell}>{attempt.outcome ?? <span className="text-muted-foreground">No disposition yet</span>}</TableCell>
                    <TableCell className={`${cell} text-right`}>{attempt.screening === "refused" ? "—" : attempt.dialled ? "Clicked" : <span className="text-muted-foreground">No click recorded</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="border-t border-border px-5 py-3 text-xs leading-normal text-muted-foreground">Times are {zoneShort(record.zones.agent)}.</p>
        </div>
      )}
    </Loading>
  );
}

// ── Callbacks ────────────────────────────────────────────────────────────────────────────────────

const CALLBACK_STATE: Record<string, { label: string; tone: StatusTone; detail: (row: RecordCallback, agent: string) => string }> = {
  scheduled: { label: "Booked", tone: "info", detail: () => "Goes back to the agent who booked it when due" },
  due: { label: "Due", tone: "warning", detail: () => "Due now — kept by a call that reaches the customer today" },
  completed: { label: "Kept", tone: "good", detail: (row, agent) => `${row.completedVia === "manual" ? "Marked done by hand" : "Called"}${row.completedAt ? ` · ${stamp(row.completedAt, agent)}` : ""}` },
  missed: { label: "Missed", tone: "danger", detail: () => "Their window closed that day with no kept call" },
  cancelled: { label: "Cancelled", tone: "neutral", detail: (row) => (row.missed ? "Missed, then cancelled or rebooked" : "Cancelled, or replaced by a new booking") },
  refused: { label: "Refused", tone: "danger", detail: () => "Outside the calling window — never stored" },
};

/**
 * The times the customer asked to be called, in their own timezone first, and what happened to
 * each — including the ones the picker refused, which are recorded on the lead as refused rather
 * than silently dropped.
 */
export function LeadCallbacksTab({ leadId }: { leadId: string }) {
  const state = useLeadRecord(leadId);
  return (
    <Loading {...state}>
      {(record) => {
        const { customer, agent, window } = record.zones;
        return (
          <div className="px-5 py-[18px]">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact label="Customer's timezone">{zoneLabel(customer)}</Fact>
              <Fact label="Your timezone">{zoneLabel(agent)}</Fact>
              <Fact label="Difference today">{difference(customer, agent)}</Fact>
              <Fact label="Legal window there">{window ? `${hourClock(window.effective.start)} – ${hourClock(window.effective.end)} ${zoneShort(customer)}${window.noSunday ? " · not Sundays" : ""}` : "Unknown — this lead has no state"}</Fact>
            </div>
            <div className="-mx-5 mt-[18px]">
              {record.callbacks.length === 0 ? (
                <p className="border-t border-border px-5 py-6 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">No callback has been booked or refused.</p>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={`${head} w-[240px]`}>Asked for</TableHead>
                      <TableHead className={`${head} w-[160px]`}>In your time</TableHead>
                      <TableHead className={`${head} w-[150px]`}>Booked by</TableHead>
                      <TableHead className={`${head} w-[130px]`}>State</TableHead>
                      <TableHead className={head}><span className="sr-only">What happened</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.callbacks.map((row) => {
                      const look = CALLBACK_STATE[row.status] ?? { label: row.status, tone: "neutral" as const, detail: () => "" };
                      return (
                        <TableRow key={row.id} className="m-row">
                          <TableCell className={`${cell} tabular-nums`}>
                            {row.scheduledAtUtc ? askedFor(row.scheduledAtUtc, row.customerTimezone) : row.requestedLocal ?? "—"}
                            {row.note && <span className="block truncate text-xs text-muted-foreground" title={row.note}>&ldquo;{row.note}&rdquo;</span>}
                          </TableCell>
                          <TableCell className={`${cell} tabular-nums`}>{row.status === "refused" || !row.scheduledAtUtc ? "—" : clockIn(row.scheduledAtUtc, agent)}</TableCell>
                          <TableCell className={cell}>{row.bookedBy ?? "—"}</TableCell>
                          <TableCell className={cell}><StatusChip tone={look.tone} dot={false}>{look.label}</StatusChip></TableCell>
                          <TableCell className={`${cell} text-muted-foreground`} title={row.refusedBecause ?? undefined}>{look.detail(row, agent)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        );
      }}
    </Loading>
  );
}

// ── Nurture ──────────────────────────────────────────────────────────────────────────────────────

const PREFERRED: Record<string, string> = { opposite_half: "Opposite half of the day", morning: "Morning", evening: "Evening", early_morning: "Early morning", late_morning: "Late morning", afternoon: "Afternoon", early_evening: "Early evening", late_evening: "Late evening", weekend: "Weekend" };
const SOURCE: Record<LeadRecord["nurture"]["cadenceSource"], string> = { campaign: "this lead's campaign cadence", agency: "your agency's cadence", default: "the default cadence" };

/**
 * Where the cadence has this lead: the dials it has had, the one it is waiting for, the ones left
 * before it stops — read from the rules the scheduler itself uses (the campaign's, else the
 * agency's, else the built-in table), so the ladder here is the one the lead is actually on.
 */
export function LeadNurtureTab({ leadId }: { leadId: string }) {
  const state = useLeadRecord(leadId);
  return (
    <Loading {...state}>
      {(record) => {
        const n = record.nurture;
        const agent = record.zones.agent;
        // A recycled lead starts its pass at attempt 1 again (20260925706500): the ladder counts only
        // the dials since it was recycled; the earlier ones stay on the Attempts tab.
        const pass = n.recycle?.context?.current ? n.recycle.context : null;
        const passStart = pass?.recycledAt ?? null;
        const firstPlaced = new Map<number, (typeof record.attempts)[number]>();
        for (const attempt of [...record.attempts].reverse()) if (attempt.number !== null && !firstPlaced.has(attempt.number) && (!passStart || Date.parse(attempt.at) >= Date.parse(passStart))) firstPlaced.set(attempt.number, attempt);
        const finished = n.leadState === "exhausted" || n.leadState === "closed" || n.attemptsMade >= n.ceiling;
        const origin = n.recycle?.origin ?? null;
        const recycledTimes = n.recycleCount ? `, recycled ${n.recycleCount} time${n.recycleCount === 1 ? "" : "s"}` : "";
        const resting = n.recycle?.resting ?? false;
        const nurtureText = origin === "recycled" && pass
          ? `Recycled ${pass.recycledAt ? stamp(pass.recycledAt, agent) : ""} after a fresh screening${recycledTimes}. ${n.attemptsMade} of ${n.ceiling} dials used on this pass; it is served after fresh leads, and after the last dial it is exhausted again.`
          : origin === "expired_transfer"
            ? `An inbound transfer nobody claimed in time. It is in the dialer as a nurture lead, served after fresh leads${recycledTimes}.`
            : resting && n.nextDialAfter
              ? `Resting until ${stamp(n.nextDialAfter, agent)} after its last outcome${recycledTimes}. It is served again then, after fresh leads.`
              : `Its rest is over${recycledTimes}; it is served again as a nurture lead, after fresh leads.`;
        const headline: { chip: string; tone: StatusTone; text: string } =
          n.leadState === "nurture" ? { chip: origin === "recycled" ? "Recycled" : resting ? "Resting" : "In nurture", tone: "info", text: nurtureText }
          : n.leadState === "closed" ? { chip: "Closed", tone: "neutral", text: "A final outcome ended the cadence. Nothing further is scheduled." }
          : finished ? { chip: "Cadence finished", tone: "neutral", text: `All ${n.ceiling} dials have been used${n.enteredNurtureAt ? ` (since ${stamp(n.enteredNurtureAt, agent)})` : ""}${recycledTimes}. It rests until an owner or producer recycles it with a new angle and it passes a fresh screening.` }
          : n.openCallbackAt ? { chip: "Not in nurture", tone: "action", text: `A callback is booked for ${askedFor(n.openCallbackAt, record.zones.customer)}. When it comes due it is served ahead of every cadence retry.` }
          : { chip: "Not in nurture", tone: "action", text: `${n.attemptsMade} of ${n.ceiling} dials used on ${SOURCE[n.cadenceSource]}. After the last one the cadence stops.` };

        return (
          <div className="px-5 py-[18px]">
            <div className="flex flex-wrap items-center gap-3.5">
              <StatusChip tone={headline.tone}>{headline.chip}</StatusChip>
              <span className="text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{headline.text}</span>
            </div>
            {pass && (
              <div className="mt-3.5 rounded-lg border border-border bg-[var(--surface-alt)] px-4 py-3 text-sm leading-normal">
                <div><span className="font-semibold">Angle for this pass:</span> <span className="text-[var(--body)]">{pass.angle}</span></div>
                {pass.script && <div className="mt-1.5 whitespace-pre-line text-[var(--body)]"><span className="font-semibold text-foreground">Script:</span> {pass.script}</div>}
              </div>
            )}
            <div className="-mx-5 mt-5">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={`${head} w-[100px]`}>Attempt</TableHead>
                    <TableHead className={`${head} w-[210px]`}>Due</TableHead>
                    <TableHead className={`${head} w-[200px]`}>Preferred</TableHead>
                    <TableHead className={`${head} w-[140px]`}>Screening</TableHead>
                    <TableHead className={head}>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {n.ladder.map((rung) => {
                    const used = firstPlaced.get(rung.attempt) ?? (rung.attempt <= n.attemptsMade ? null : undefined);
                    const next = rung.attempt === n.attemptsMade + 1 && !finished;
                    const preferred = rung.preferred ? PREFERRED[rung.preferred] ?? rung.preferred.replace(/_/g, " ") : "Any legal time";
                    const due = used ? stamp(used.at, agent)
                      : rung.attempt <= n.attemptsMade ? "Before this record"
                      : next ? (n.nextDialAfter ? `After ${stamp(n.nextDialAfter, agent)}` : rung.attempt === 1 ? "When first served" : "When served")
                      : `${rung.delay} after #${rung.attempt - 1}`;
                    const status = used || rung.attempt <= n.attemptsMade ? `Used${used?.outcome ? ` · ${used.outcome.toLowerCase()}` : ""}`
                      : finished ? "Not used"
                      : next ? (n.openCallbackAt ? "Next · the callback comes first" : "Next")
                      : "Not yet";
                    return (
                      <TableRow key={rung.attempt} className="m-row">
                        <TableCell className={`${cell} tabular-nums`}>{rung.attempt}</TableCell>
                        <TableCell className={`${cell} tabular-nums`}>{due}</TableCell>
                        <TableCell className={cell}>{preferred}</TableCell>
                        <TableCell className={cell}>{used ? <StatusChip tone="good" dot={false}>Passed</StatusChip> : rung.attempt <= n.attemptsMade || finished ? "—" : "At the dial"}</TableCell>
                        <TableCell className={cell}>{status}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {n.reactivations.length > 0 && (
                <p className="border-t border-border px-5 py-3 text-xs leading-normal text-muted-foreground">
                  Recycled from nurture: {n.reactivations.map((row) => {
                    const angle = n.recycle?.anglesByReactivation?.[row.id];
                    return `#${row.recycleNumber} ${stamp(row.reactivatedAt, agent)} (${row.status === "failed" ? "held — screening did not complete" : row.status}${row.screeningOutcome ? `, screening ${row.screeningOutcome}` : ""}${angle ? `, angle “${angle}”` : ""})`;
                  }).join(" · ")}
                </p>
              )}
            </div>
          </div>
        );
      }}
    </Loading>
  );
}
