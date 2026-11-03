"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, PhoneOutgoing } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { WAITING_ON_TONE } from "@/lib/applications/constants";
import { TableCard } from "@/components/ui/table-card";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { useFittingPageSize, ViewTabs } from "@/components/app/book-views";
import {
  ageingFor, byRisk, dayMonth, deltaText, expiryCountdown, REQUIREMENT_SHORT_LABEL, shortPersonName, summarise, waitingOnText, wholeDaysSince,
  type AwaitingNumberRow, type CounterofferRow, type RequirementRow,
} from "@/lib/applications/listRules";
import { caseHref, clientLinkClass, useLiveRefresh } from "./applications-list";
import { AttemptStatusChip, dateTime, face, money, SampleDataNotice } from "./parts";

// Not exported as a value: this is a client module, so a server page importing it would get a
// client reference, not the array. The page keeps its own list of valid `?tab=` values.
const PENDING_TABS = [
  { key: "requirements", label: "Requirements" },
  { key: "counteroffers", label: "Counteroffers" },
  { key: "awaiting", label: "Awaiting policy number" },
] as const;
export type PendingTab = (typeof PENDING_TABS)[number]["key"];

/** The table card fills the viewport under the header, strip and tab row (2026-10-06 redesign). */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-392px)] flex-col [&>*:nth-child(2)]:flex-1";

type PendingPayload = { requirements: RequirementRow[]; counteroffers: CounterofferRow[]; awaiting: AwaitingNumberRow[]; ageingDays: number };

function AgeChip({ days, ageing }: { days: number; ageing: "ok" | "amber" | "red" }) {
  const text = `${days} ${days === 1 ? "day" : "days"}`;
  if (ageing === "red") return <StatusChip tone="danger" dot={false}>{text}</StatusChip>;
  if (ageing === "amber") return <StatusChip tone="warning" dot={false}>{text}</StatusChip>;
  return <span className="text-muted-foreground">{text}</span>;
}

export function PendingCases({
  requirements: initialRequirements,
  counteroffers: initialCounteroffers,
  awaiting: initialAwaiting,
  ageingDays: initialAgeingDays,
  initialTab = "requirements",
  readOnly = false,
  sample = false,
  timeZone,
  embedded = false,
}: {
  requirements: RequirementRow[];
  counteroffers: CounterofferRow[];
  awaiting: AwaitingNumberRow[];
  ageingDays: number;
  initialTab?: PendingTab;
  readOnly?: boolean;
  sample?: boolean;
  timeZone?: string;
  /** The Waiting on the carrier tab of Applications (2026-10-26): no header of its own. */
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<PendingTab>(initialTab);
  const [data, setData] = useState<PendingPayload>({ requirements: initialRequirements, counteroffers: initialCounteroffers, awaiting: initialAwaiting, ageingDays: initialAgeingDays });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pageSize = useFittingPageSize(560, 45);
  const pick = useCallback((body: unknown) => { const b = body as Partial<PendingPayload> | null; return b?.requirements && b.counteroffers && b.awaiting && typeof b.ageingDays === "number" ? (b as PendingPayload) : null; }, []);
  const apply = useCallback((value: PendingPayload) => { setData(value); setNow(Date.now()); }, []);
  const { refresh, refreshing, error } = useLiveRefresh({ sample, url: "/api/app/pending", pick, apply });
  const { requirements, counteroffers, awaiting, ageingDays } = data;

  function changeTab(next: PendingTab) {
    setTab(next); setPage(1); setSearch("");
    // Keep the tab in the address so a dashboard card can link straight to it.
    try {
      const url = new URL(window.location.href);
      if (next === "requirements") url.searchParams.delete("tab"); else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch { /* not fatal */ }
  }

  async function logChase(row: RequirementRow) {
    if (sample) {
      setData((d) => ({ ...d, requirements: d.requirements.map((r) => (r.id === row.id ? { ...r, chaseCount: r.chaseCount + 1, lastChasedAt: new Date().toISOString(), lastChasedByName: "You", daysSinceChase: 0 } : r)) }));
      notify.done(`Chase logged for ${row.clientName}.`, { detail: "Sample data — nothing is saved." });
      return;
    }
    setBusy(row.id);
    try {
      const r = await fetch(`/api/app/pending/requirements/${encodeURIComponent(row.id)}/chase`, { method: "POST" });
      const body = (await r.json().catch(() => null)) as { chaseCount?: number; lastChasedAt?: string; error?: string } | null;
      if (!r.ok || !body?.lastChasedAt) { notify.block(body?.error ?? "Could not log the chase. Try again."); return; }
      setData((d) => ({ ...d, requirements: d.requirements.map((x) => (x.id === row.id ? { ...x, chaseCount: body.chaseCount ?? x.chaseCount + 1, lastChasedAt: body.lastChasedAt ?? x.lastChasedAt, lastChasedByName: "You", daysSinceChase: 0 } : x)) }));
      notify.done(`Chase logged for ${row.clientName}.`, { detail: `${body.chaseCount} ${body.chaseCount === 1 ? "chase" : "chases"} on this requirement.` });
    } catch {
      notify.fail("Could not log the chase — check your connection.");
    } finally {
      setBusy(null);
    }
  }

  const overdueRows = requirements.filter((row) => ageingFor(row.daysOpen, ageingDays) === "red");
  async function chaseOverdue() {
    if (sample) { notify.done(`${overdueRows.length} chases logged.`, { detail: "Sample data — nothing is saved." }); return; }
    setBusy("all");
    try {
      const r = await fetch("/api/app/pending/requirements/chase-overdue", { method: "POST" });
      const body = (await r.json().catch(() => null)) as { chased?: unknown[]; failed?: unknown[]; skippedChasedToday?: number; error?: string } | null;
      if (!r.ok || !body) { notify.block(body?.error ?? "Could not log the chases. Try again."); return; }
      const n = body.chased?.length ?? 0;
      const skipped = body.skippedChasedToday ?? 0;
      if (body.failed?.length) notify.warn(`${n} chases logged; ${body.failed.length} could not be.`, { detail: "Refresh and try those again." });
      else notify.done(n ? `${n} ${n === 1 ? "chase" : "chases"} logged.` : "Nothing to chase.", { detail: skipped ? `${skipped} already chased today.` : undefined });
      await refresh();
    } catch {
      notify.fail("Could not log the chases — check your connection.");
    } finally {
      setBusy(null);
    }
  }

  const needle = search.trim().toLowerCase();
  const matches = (...values: (string | null | undefined)[]) => !needle || values.some((value) => value?.toLowerCase().includes(needle));
  const clearFilters = () => { setSearch(""); setPage(1); };
  const summary = summarise({ requirements, counteroffers, awaiting, ageingDays, now });

  const counts: Record<PendingTab, number> = { requirements: requirements.length, counteroffers: counteroffers.length, awaiting: awaiting.length };
  const toolbar = (placeholder: string) => (
    <>
      <DataToolbar actions={<>
        {needle && <ClearFiltersButton onClick={clearFilters} />}
        <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
      </>}>
        <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={placeholder} />
      </DataToolbar>
      {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
    </>
  );

  const shownRequirements = requirements.filter((row) => matches(row.clientName, row.carrierName, REQUIREMENT_SHORT_LABEL[row.kind], row.description, waitingOnText(row))).sort(byRisk);
  const shownCounteroffers = counteroffers.filter((row) => matches(row.clientName, row.carrierName, row.reason)).sort((a, b) => (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"));
  const shownAwaiting = awaiting
    .map((row) => ({ row, days: wholeDaysSince(row.submittedAt, now) ?? 0 }))
    .filter(({ row }) => matches(row.clientName, row.carrierName, row.reference))
    .sort((a, b) => b.days - a.days || a.row.clientName.localeCompare(b.row.clientName));

  function exportCsv() {
    if (tab === "requirements") {
      downloadCsv("pending-requirements.csv", ["Client", "Carrier", "Requirement", "Detail", "Waiting on", "Raised", "Age (days)", "Last chased", "Chased by", "Chases"],
        shownRequirements.map((r) => [r.clientName, r.carrierName, REQUIREMENT_SHORT_LABEL[r.kind], r.description, waitingOnText(r), r.raisedAt, r.daysOpen, r.lastChasedAt, r.lastChasedByName ?? null, r.chaseCount]));
    } else if (tab === "counteroffers") {
      downloadCsv("pending-counteroffers.csv", ["Client", "Carrier", "Applied face", "Offered face", "Face difference", "Applied monthly", "Offered monthly", "Premium difference", "Reason", "Expires"],
        shownCounteroffers.map((r) => [r.clientName, r.carrierName, (r.applied.faceCents / 100).toFixed(2), (r.offered.faceCents / 100).toFixed(2), deltaText(r.applied.faceCents, r.offered.faceCents, true), (r.applied.monthlyCents / 100).toFixed(2), (r.offered.monthlyCents / 100).toFixed(2), deltaText(r.applied.monthlyCents, r.offered.monthlyCents), r.reason, r.expiresAt]));
    } else {
      downloadCsv("awaiting-policy-number.csv", ["Client", "Carrier", "Product", "Missing", "Carrier reference", "Submitted", "Days since submitted", "Monthly premium"],
        shownAwaiting.map(({ row, days }) => [row.clientName, row.carrierName, row.productLabel, row.missing === "reference" ? "Carrier reference" : "Policy number", row.reference, row.submittedAt, days, row.monthlyPremiumCents === null ? null : (row.monthlyPremiumCents / 100).toFixed(2)]));
    }
  }
  const exportCount = tab === "requirements" ? shownRequirements.length : tab === "counteroffers" ? shownCounteroffers.length : shownAwaiting.length;

  let panel: ReactNode;
  if (tab === "requirements") {
    const { current, rows } = paginate(shownRequirements, page, pageSize);
    panel = (
      <TableCard className={FILL} toolbar={toolbar("Search client, carrier, requirement")} footer={<Pager page={current} total={shownRequirements.length} pageSize={pageSize} noun="open requirements" onPage={setPage} suffix="waiting on the client first, then oldest" />}>
        {requirements.length === 0
          ? <EmptyState title="No open requirements" hint="Carrier requests after submission show here." />
          : shownRequirements.length === 0
            ? <NoMatches noun="requirements" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1230px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="w-[150px]">Carrier</th>
                    <th className="w-[180px]">Requirement</th>
                    <th className="w-[150px]">Waiting on</th>
                    <th className="w-[100px]"><span className="inline-flex items-center gap-1">Age<InfoTip label="About age">Days since the carrier raised it. Amber from {ageingDays} days, red from {ageingDays * 2}.</InfoTip></span></th>
                    <th className="w-[110px] text-right">At stake</th>
                    <th className="w-[130px]">Last chased</th>
                    <th className="w-[80px] text-right">Chases</th>
                    <th className="w-[140px] text-right"><span className="sr-only">Log a chase</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, step: "after", from: "/app/pending" });
                    const who = shortPersonName(row.lastChasedByName);
                    return (
                      <tr key={row.id} className="m-row">
                        <td className="max-w-[220px] truncate" title={row.clientName}><Link href={href} className={clientLinkClass}>{row.clientName}</Link></td>
                        <td className="max-w-[150px] truncate" title={row.carrierName ?? undefined}>{row.carrierName ?? "—"}</td>
                        <td className="max-w-[180px] truncate" title={row.description || undefined}>{REQUIREMENT_SHORT_LABEL[row.kind]}</td>
                        <td><StatusChip tone={WAITING_ON_TONE[row.waitingOn]} dot={false}>{waitingOnText(row)}</StatusChip></td>
                        <td title={`Raised ${dayMonth(row.raisedAt)} · amber from ${ageingDays} days, red from ${ageingDays * 2}`}><AgeChip days={row.daysOpen} ageing={ageingFor(row.daysOpen, ageingDays)} /></td>
                        <td className="text-right tabular-nums" title="The monthly premium this requirement holds up">{row.monthlyPremiumCents === null ? "—" : `${money(row.monthlyPremiumCents)}/mo`}</td>
                        {/* Days since the last chase, as a number (LA-3.18); the date and who on hover. */}
                        <td title={row.lastChasedAt ? `${dayMonth(row.lastChasedAt, timeZone)}${who ? ` · ${who}` : ""}` : undefined}>{row.lastChasedAt ? `${row.daysSinceChase ?? 0} ${(row.daysSinceChase ?? 0) === 1 ? "day" : "days"} ago${who ? ` · ${who}` : ""}` : <span className="text-muted-foreground">Not yet</span>}</td>
                        <td className="text-right tabular-nums">{row.chaseCount}</td>
                        <td className="text-right">
                          <Button type="button" variant="outline" size="sm" onClick={() => void logChase(row)} disabled={readOnly || busy !== null} title={readOnly ? "Read-only — your plan does not allow changes" : undefined} aria-label={`Log a chase for ${row.clientName}`}>
                            <PhoneOutgoing aria-hidden="true" />Log a chase
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>
    );
  } else if (tab === "counteroffers") {
    const { current, rows } = paginate(shownCounteroffers, page, pageSize);
    panel = (
      <TableCard className={FILL} toolbar={toolbar("Search client, carrier")} footer={<Pager page={current} total={shownCounteroffers.length} pageSize={pageSize} noun="open counteroffers" onPage={setPage} suffix="soonest to expire first" />}>
        {counteroffers.length === 0
          ? <EmptyState title="No counteroffers waiting" hint="Offers at a different rate or benefit show here." />
          : shownCounteroffers.length === 0
            ? <NoMatches noun="counteroffers" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1260px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="w-[150px]">Carrier</th>
                    <th className="w-[220px]">Reason</th>
                    <th className="w-[110px] text-right">Applied for</th>
                    <th className="w-[110px] text-right">Offered</th>
                    <th className="w-[150px] text-right">Face change</th>
                    <th className="w-[150px] text-right">Premium change</th>
                    <th className="w-[130px]">Expires</th>
                    <th className="w-[96px] text-right"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, step: "after", from: "/app/pending" });
                    const countdown = expiryCountdown(row.expiresAt, now);
                    const premiumChanged = row.applied.monthlyCents !== row.offered.monthlyCents;
                    return (
                      <tr key={row.id} className="m-row">
                        <td className="max-w-[220px] truncate" title={row.clientName}><Link href={href} className={clientLinkClass}>{row.clientName}</Link></td>
                        <td className="max-w-[150px] truncate" title={row.carrierName ?? undefined}>{row.carrierName ?? "—"}</td>
                        <td className="max-w-[220px]"><span className="block truncate" title={row.reason}>{row.reason || "—"}</span><span className="block text-xs text-muted-foreground">received {dayMonth(row.receivedAt, timeZone)}</span></td>
                        <td className="text-right tabular-nums">{face(row.applied.faceCents)}</td>
                        <td className="text-right tabular-nums">{face(row.offered.faceCents)}</td>
                        <td className="text-right tabular-nums">{deltaText(row.applied.faceCents, row.offered.faceCents, true)}</td>
                        <td className="text-right tabular-nums" title={premiumChanged ? `${money(row.applied.monthlyCents)} applied, ${money(row.offered.monthlyCents)} offered, a month` : undefined}>
                          {premiumChanged ? deltaText(row.applied.monthlyCents, row.offered.monthlyCents) : <span className="text-muted-foreground">No change</span>}
                        </td>
                        <td>{countdown ? <StatusChip tone={countdown.tone} dot title={row.expiresAt ? `Expires ${dateTime(row.expiresAt, timeZone)}` : undefined}>{countdown.label}</StatusChip> : <span className="text-muted-foreground">No expiry</span>}</td>
                        <td className="text-right"><Button asChild variant="outline" size="sm"><Link href={href} aria-label={`Open ${row.clientName}'s counteroffer`}>Open</Link></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>
    );
  } else {
    const { current, rows } = paginate(shownAwaiting, page, pageSize);
    panel = (
      <TableCard className={FILL} toolbar={toolbar("Search client, carrier, reference")} footer={<Pager page={current} total={shownAwaiting.length} pageSize={pageSize} noun="applications" onPage={setPage} suffix="longest waiting first" />}>
        {awaiting.length === 0
          ? <EmptyState title="Every application has its number" hint="Missing references and policy numbers show here." />
          : shownAwaiting.length === 0
            ? <NoMatches noun="applications" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1260px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="w-[90px]">Insured</th>
                    <th className="w-[150px]">Carrier</th>
                    <th className="w-[130px]">Product</th>
                    <th className="w-[150px]">Status</th>
                    <th className="w-[160px]">Missing</th>
                    <th className="w-[130px]">Reference</th>
                    <th className="w-[100px]">Submitted</th>
                    <th className="w-[100px]">Waiting</th>
                    <th className="w-[96px] text-right">Premium</th>
                    <th className="w-[120px] text-right"><span className="sr-only">Add number</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map(({ row, days }) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, attempt: row.attemptNo, step: "after", from: "/app/pending" });
                    return (
                      <tr key={`${row.applicationId}-${row.insuredRole}`} className="m-row">
                        <td className="max-w-[220px] truncate" title={row.clientName}><Link href={href} className={clientLinkClass}>{row.clientName}</Link></td>
                        <td>{row.insuredRole === "spouse" ? "Spouse" : "Primary"}</td>
                        <td className="max-w-[150px] truncate" title={row.carrierName ?? undefined}>{row.carrierName ?? "—"}</td>
                        <td className="max-w-[130px] truncate" title={row.productLabel ?? undefined}>{row.productLabel ?? "—"}</td>
                        <td><AttemptStatusChip status={row.status} outcome={row.outcome} /></td>
                        <td><StatusChip tone="warning">{row.missing === "reference" ? "Carrier reference" : "Policy number"}</StatusChip></td>
                        <td>{row.reference ? <code className="font-mono text-xs tabular-nums">{row.reference}</code> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="tabular-nums">{dayMonth(row.submittedAt, timeZone)}</td>
                        <td><AgeChip days={days} ageing={ageingFor(days, ageingDays)} /></td>
                        <td className="text-right tabular-nums">{money(row.monthlyPremiumCents)}</td>
                        <td className="text-right">
                          {readOnly
                            ? <Button type="button" variant="outline" size="sm" disabled title="Read-only — your plan does not allow changes">Add number</Button>
                            : <Button asChild variant="outline" size="sm"><Link href={href} aria-label={`Add the number for ${row.clientName}`}>Add number</Link></Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>}
      </TableCard>
    );
  }

  return (
    <div className={embedded ? "flex flex-col gap-6" : "m-stagger flex flex-col gap-6"}>
      {!embedded && <PageHeader title="Pending cases" />}
      {sample && <SampleDataNotice />}

      {/* One strip, under the header, for all three lists (2026-10-06 redesign): each figure is one
          of the tabs' reasons to act. */}
      <StatStrip label="Pending totals">
        <StatTile label="Waiting on the client" value={summary.waitingOnClient.count} valueTone={summary.waitingOnClient.count > 0 ? "warning" : undefined} footnote="a call or a signature" />
        <StatTile label="Overdue" value={summary.waitingOnClient.overdue} valueTone={summary.waitingOnClient.overdue > 0 ? "danger" : undefined} footnote={`older than ${summary.waitingOnClient.overdueAfterDays} days`} />
        <StatTile label="Counteroffers expiring" value={summary.counteroffersExpiring.count} valueTone={summary.counteroffersExpiring.count > 0 ? "warning" : undefined} footnote={`inside ${summary.counteroffersExpiring.withinDays} days`} />
        <StatTile label="Missing carrier reference" value={summary.awaitingPolicyNumber.missingReference} footnote="cannot be matched yet" />
      </StatStrip>

      {/* The lists on the left, the page's actions on the right of the same row. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs label="Pending case lists" idPrefix="pending-tab" tabs={PENDING_TABS.map((item) => ({ ...item, count: counts[item.key] }))} value={tab} onChange={changeTab} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={exportCsv} disabled={exportCount === 0} title={exportCount === 0 ? "Nothing to export on this tab" : undefined}><Download aria-hidden="true" />Export</Button>
          <Button
            type="button"
            onClick={() => void chaseOverdue()}
            disabled={readOnly || busy !== null || overdueRows.length === 0}
            title={readOnly ? "Read-only — your plan does not allow changes" : overdueRows.length === 0 ? "Nothing is overdue" : `Log a chase on the ${overdueRows.length} requirements older than ${ageingDays * 2} days`}
          >
            Chase everything overdue
          </Button>
        </div>
      </div>

      <div id="pending-panel" role="tabpanel" aria-labelledby={`pending-tab-${tab}`}>{panel}</div>
    </div>
  );
}
