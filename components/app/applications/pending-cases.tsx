"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, PhoneOutgoing } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { downloadCsv } from "@/components/app/partner-quality-parts";
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

const tabClass = (active: boolean) => `-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-1 text-sm font-semibold leading-[1.43] tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`;

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
}: {
  requirements: RequirementRow[];
  counteroffers: CounterofferRow[];
  awaiting: AwaitingNumberRow[];
  ageingDays: number;
  initialTab?: PendingTab;
  readOnly?: boolean;
  sample?: boolean;
  timeZone?: string;
}) {
  const [tab, setTab] = useState<PendingTab>(initialTab);
  const [data, setData] = useState<PendingPayload>({ requirements: initialRequirements, counteroffers: initialCounteroffers, awaiting: initialAwaiting, ageingDays: initialAgeingDays });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pick = useCallback((body: unknown) => { const b = body as Partial<PendingPayload> | null; return b?.requirements && b.counteroffers && b.awaiting && typeof b.ageingDays === "number" ? (b as PendingPayload) : null; }, []);
  const apply = useCallback((value: PendingPayload) => { setData(value); setNow(Date.now()); }, []);
  const { refresh, refreshing, error } = useLiveRefresh({ sample, url: "/api/app/pending", pick, apply });
  const { requirements, counteroffers, awaiting, ageingDays } = data;

  function changeTab(next: PendingTab) {
    setTab(next); setPage(1); setSearch("");
    // Keep the tab in the address so a dashboard card can link straight to it.
    try { window.history.replaceState(null, "", next === "requirements" ? window.location.pathname : `?tab=${next}`); } catch { /* not fatal */ }
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
      <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
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
    const { current, rows } = paginate(shownRequirements, page);
    panel = (
      <TableCard toolbar={toolbar("Search a client, a carrier or a requirement")} footer={<Pager page={current} total={shownRequirements.length} noun="open requirements" onPage={setPage} suffix="waiting on the client first, then oldest" />}>
        {requirements.length === 0
          ? <EmptyState title="No open requirements" hint="When a carrier asks for something after submission — an APS, a phone interview, a signature — it shows here until it is met." />
          : shownRequirements.length === 0
            ? <NoMatches noun="requirements" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[150px]">Client</th>
                    <th className="w-[138px]">Carrier</th>
                    <th className="w-[186px]">Requirement</th>
                    <th className="w-[150px]">Waiting on</th>
                    <th className="w-[100px]">Age</th>
                    <th className="w-[152px]">Last chased</th>
                    <th className="w-[128px] text-right"><span className="sr-only">Log a chase</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, step: "after" });
                    const who = shortPersonName(row.lastChasedByName);
                    return (
                      <tr key={row.id} className="m-row">
                        <td><Link href={href} className={clientLinkClass}>{row.clientName}</Link></td>
                        <td>{row.carrierName ?? "—"}</td>
                        <td title={row.description || undefined}>{REQUIREMENT_SHORT_LABEL[row.kind]}</td>
                        <td>{waitingOnText(row)}</td>
                        <td title={`Raised ${dayMonth(row.raisedAt)} · amber from ${ageingDays} days, red from ${ageingDays * 2}`}><AgeChip days={row.daysOpen} ageing={ageingFor(row.daysOpen, ageingDays)} /></td>
                        <td title={row.chaseCount ? `${row.chaseCount} ${row.chaseCount === 1 ? "chase" : "chases"}` : undefined}>{row.lastChasedAt ? `${dayMonth(row.lastChasedAt, timeZone)}${who ? ` · ${who}` : ""}` : <span className="text-muted-foreground">Not yet</span>}</td>
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
    const { current, rows } = paginate(shownCounteroffers, page);
    panel = (
      <TableCard toolbar={toolbar("Search a client or a carrier")} footer={<Pager page={current} total={shownCounteroffers.length} noun="open counteroffers" onPage={setPage} suffix="soonest to expire first" />}>
        {counteroffers.length === 0
          ? <EmptyState title="No counteroffers waiting" hint="When a carrier approves at a different rate or benefit, the offer waits here for the client's answer." />
          : shownCounteroffers.length === 0
            ? <NoMatches noun="counteroffers" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[920px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[160px]">Client</th>
                    <th className="w-[146px]">Carrier</th>
                    <th className="w-[118px]">Applied for</th>
                    <th className="w-[108px]">Offered</th>
                    <th className="w-[176px]">Difference</th>
                    <th className="w-[118px]">Expires</th>
                    <th className="w-[96px] text-right"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map((row) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, step: "after" });
                    const countdown = expiryCountdown(row.expiresAt, now);
                    const premiumChanged = row.applied.monthlyCents !== row.offered.monthlyCents;
                    return (
                      <tr key={row.id} className="m-row">
                        <td><Link href={href} className={clientLinkClass}>{row.clientName}</Link></td>
                        <td>{row.carrierName ?? "—"}</td>
                        <td className="tabular-nums">{face(row.applied.faceCents)}</td>
                        <td className="tabular-nums">{face(row.offered.faceCents)}</td>
                        <td className="tabular-nums">
                          <span className="block">{deltaText(row.applied.faceCents, row.offered.faceCents, true)}</span>
                          {premiumChanged && <span className="block text-xs text-muted-foreground" title={`${money(row.applied.monthlyCents)} applied, ${money(row.offered.monthlyCents)} offered, a month`}>Premium {deltaText(row.applied.monthlyCents, row.offered.monthlyCents)}</span>}
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
    const { current, rows } = paginate(shownAwaiting, page);
    panel = (
      <TableCard toolbar={toolbar("Search a client, a carrier or a reference")} footer={<Pager page={current} total={shownAwaiting.length} noun="applications" onPage={setPage} suffix="longest waiting first" />}>
        {awaiting.length === 0
          ? <EmptyState title="Every submitted application has its number" hint="An application shows here when it is submitted without a carrier reference, or issued without a policy number." />
          : shownAwaiting.length === 0
            ? <NoMatches noun="applications" onClear={clearFilters} />
            : <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[160px]">Client</th>
                    <th className="w-[160px]">Carrier</th>
                    <th className="w-[150px]">Status</th>
                    <th className="w-[160px]">Missing</th>
                    <th className="w-[110px]">Submitted</th>
                    <th className="w-[100px]">Waiting</th>
                    <th className="w-[96px]">Premium</th>
                    <th className="w-[120px] text-right"><span className="sr-only">Add number</span></th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {rows.map(({ row, days }) => {
                    const href = caseHref(row.caseId, { insured: row.insuredRole, attempt: row.attemptNo, step: "after" });
                    return (
                      <tr key={`${row.applicationId}-${row.insuredRole}`} className="m-row">
                        <td>
                          <Link href={href} className={clientLinkClass}>{row.clientName}</Link>
                          {row.insuredRole === "spouse" && <span className="block text-xs text-muted-foreground">spouse</span>}
                        </td>
                        <td>
                          <span className="block">{row.carrierName ?? "—"}</span>
                          {row.productLabel && <span className="block text-xs text-muted-foreground">{row.productLabel}</span>}
                        </td>
                        <td><AttemptStatusChip status={row.status} outcome={row.outcome} /></td>
                        <td>
                          <StatusChip tone="warning">{row.missing === "reference" ? "Carrier reference" : "Policy number"}</StatusChip>
                          {row.reference && <span className="block font-mono text-xs tabular-nums text-muted-foreground">{row.reference}</span>}
                        </td>
                        <td className="tabular-nums">{dayMonth(row.submittedAt, timeZone)}</td>
                        <td><AgeChip days={days} ageing={ageingFor(days, ageingDays)} /></td>
                        <td className="tabular-nums">{money(row.monthlyPremiumCents)}</td>
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
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Pending cases"
        description="What each submitted application is waiting on, oldest first."
        actions={<>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={exportCount === 0} title={exportCount === 0 ? "Nothing to export on this tab" : undefined}><Download aria-hidden="true" />Export</Button>
          <Button
            type="button"
            onClick={() => void chaseOverdue()}
            disabled={readOnly || busy !== null || overdueRows.length === 0}
            title={readOnly ? "Read-only — your plan does not allow changes" : overdueRows.length === 0 ? "Nothing is overdue" : `Log a chase on the ${overdueRows.length} requirements older than ${ageingDays * 2} days`}
          >
            Chase everything overdue
          </Button>
        </>}
      />
      {sample && <SampleDataNotice />}

      <div className="flex flex-col gap-6">
        <div role="tablist" aria-label="Pending case lists" className="flex flex-wrap gap-6 border-b border-border">
          {PENDING_TABS.map((item) => (
            <button key={item.key} id={`pending-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls="pending-panel" onClick={() => changeTab(item.key)} className={tabClass(tab === item.key)}>
              {item.label}
              <span className="text-xs font-semibold tabular-nums text-muted-foreground">{counts[item.key]}</span>
            </button>
          ))}
        </div>

        {tab === "requirements" && (
          <StatStrip label="Pending totals">
            <StatTile label="Waiting on the client" value={summary.waitingOnClient.count} valueTone={summary.waitingOnClient.count > 0 ? "warning" : undefined} footnote="a call or a signature" />
            <StatTile label="Overdue" value={summary.waitingOnClient.overdue} valueTone={summary.waitingOnClient.overdue > 0 ? "danger" : undefined} footnote={`older than ${summary.waitingOnClient.overdueAfterDays} days`} />
            <StatTile label="Counteroffers expiring" value={summary.counteroffersExpiring.count} valueTone={summary.counteroffersExpiring.count > 0 ? "warning" : undefined} footnote={`inside ${summary.counteroffersExpiring.withinDays} days`} />
            <StatTile label="Missing carrier reference" value={summary.awaitingPolicyNumber.missingReference} footnote="cannot be matched yet" />
          </StatStrip>
        )}

        <div id="pending-panel" role="tabpanel" aria-labelledby={`pending-tab-${tab}`}>{panel}</div>
      </div>
    </div>
  );
}
