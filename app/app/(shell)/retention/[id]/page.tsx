import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { REASON_LABELS, STEP_LABELS, STEP_SLUG, type Reason, type Step } from "@/lib/retention/cases/ladder";
import { caseHref, listQuery, neighbours, parseListFilters, visibleCases, type ListFilters } from "@/lib/retention/cases/listOrder";
import { loadCase, loadLadder, monthly } from "@/lib/retention/cases/store";
import { loadCase as loadReinstatementCase } from "@/lib/retention/reinstatementStore";
import { carrierPolicyHref } from "@/lib/ingestion/policyPage";
import { loadLadderSettings } from "@/lib/retention/cases/sync";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage } from "@/components/app/retention/retention-page";
import { CaseActions, CaseCalls, WhatToDo } from "@/components/app/retention/case-view";
import { STATUS_MEANING, whyLine } from "@/components/app/retention/ladder-mark";
import { buttonVariants } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { IntentLink } from "@/components/ui/nav-pending";

/**
 * Retention › Cases › a case (pick A, owner 2026-11-05; round 7, owner pick 1·A, 2026-11-10; docs/la4/mockups-r7/
 * retention.html boards 1·1–1·5). The client's name alone on its line; its tabs What to do · Calls · Policy ·
 * History beside it; ‹ › name the previous and next case in the list it was opened from (`?from=`, the list's
 * address; else the case's own step); then "Log the call" (a dialog) and ⋯. Under the title a strip of figures,
 * each a link: the stage, the deadline, the premium, the phone, the owner. What to do holds the step's playbook,
 * each step's button opening its dialog. Opening it writes nothing.
 */
type Tab = "do" | "calls" | "policy" | "history";
const TABS: Tab[] = ["do", "calls", "policy", "history"];
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const EVENT_TEXT: Record<string, string> = { opened: "Opened", step_moved: "Moved", evidence: "File update", assigned: "Assigned", call: "Call", fix: "Fix recorded", note: "Note", servicing_linked: "Request sent to the carrier", resolved: "Closed", reopened: "Reopened" };
const nameOf = (r: { clientName: string | null; policyNumber: string }) => (r.clientName ? personName(r.clientName) : `Policy ${r.policyNumber}`);

/**
 * What happens next if nothing is done, in words. A passed deadline says so (round 7): the window closed while
 * the carrier's files still show the policy, so the carrier is the one to ask, never "if unpaid on <a past date>".
 */
function ifNothing(step: Step, deadline: string | null, daysLeft: number | null, latestFile: string | null): string {
  if (deadline && daysLeft !== null && daysLeft < 0 && step !== "lost" && step !== "paperwork") {
    return `The carrier's window closed ${fileDay(deadline)}; its latest file${latestFile ? ` (${fileDay(latestFile)})` : ""} still shows the policy. Ask the carrier where it stands.`;
  }
  const unpaid = deadline ? `If it is still unpaid on ${fileDay(deadline)}` : "If it stays unpaid";
  if (step === "payment_problem") return `${unpaid}, it becomes a pending lapse.`;
  if (step === "pending_lapse") return `${unpaid}, the policy lapses.`;
  if (step === "lapsed_reinstatable") return `If it isn't reinstated${deadline ? ` by ${fileDay(deadline)}` : ""}, it is lost for good.`;
  if (step === "lost") return "Close it to win-back; the client is called again after the cooling-off.";
  return "Clear it before it blocks the policy.";
}

export default async function RetentionCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string }> }) {
  const [guard, { id }, query] = await Promise.all([guardPage("chargeback_radar"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention" description="Every policy the carrier files flag, at its risk point, with what to do." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Retention" detail="Only owners, producers and retention reps work retention cases." />;
  if (!isRecordUuid(id)) notFound();
  const viewerId = guard.context.userId;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "do";
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the step draw at once and the name waits in a
  // title-shaped placeholder. The reads start here, in the order they ran: the case and the settings (the name, the
  // counts, the strip and the tab wait on these), then the ladder for ‹ › and step 3's reinstatement.
  const viewerRead = scopeFor(guard.context).then((scope) => ({ tenantId: guard.context.tenantId, userId: viewerId, role: guard.role, scope }));
  const read = viewerRead.then(async (viewer): Promise<Case | null> => {
    const [loaded, settings] = await Promise.all([loadCase(viewer, id), loadLadderSettings(guard.context.tenantId)]);
    if (!loaded) return null;
    const { row } = loaded;
    // The list it came from (its tab and filters); a case opened from elsewhere walks its own step.
    const fromParams = new URLSearchParams(query.from ?? "");
    const f: ListFilters = query.from ? parseListFilters((key) => fromParams.get(key)) : parseListFilters((key) => (key === "step" ? STEP_SLUG[row.step] : null));
    const open = row.status !== "saved" && row.status !== "lost" && row.status !== "closed_no_save";
    return { ...loaded, settings, f, open, name: nameOf(row), listHref: `/app/retention?${listQuery(f)}` };
  });
  const more = Promise.all([viewerRead, read]).then(async ([viewer, c]) => {
    if (!c) return null;
    const { row, reinstatementId, open, f } = c;
    // Step 3 works the reinstatement here (critique D1): its row, read the way its own page read it.
    const [reinstatement, ladder] = await Promise.all([
      row.step === "lapsed_reinstatable" && reinstatementId && tab === "do"
        ? loadReinstatementCase(viewer, reinstatementId).then((r) => (r.available ? r.row : null)).catch(() => null)
        : Promise.resolve(null),
      open ? loadLadder(viewer).catch(() => null) : Promise.resolve(null),
    ]);
    const ordered = ladder && ladder.available ? visibleCases(ladder.open, f, viewerId) : [];
    return { reinstatement, ...neighbours(ordered, row.id) };
  });
  const both = Promise.all([read, more]);
  /** The case, or the 404 once the read says it is not this person's (or not there). */
  const found = (c: Case | null) => {
    if (!c) notFound();
    return c;
  };
  // Before the read, the tabs keep the list the case was opened from (`?from=`, as the address has it).
  const here = (t: Tab, f: ListFilters | null) => `/app/retention/${id}?${new URLSearchParams({ ...(t === "do" ? {} : { tab: t }), ...(f ? { from: listQuery(f) } : query.from ? { from: query.from } : {}) })}`;
  const tabsOf = (c: Case | null) => (
    <ViewTabs label={c?.name ?? "Case"} value={tab} tabs={[
      { key: "do", label: "What to do", href: here("do", c?.f ?? null) },
      { key: "calls", label: "Calls", ...(c ? { count: c.calls.length } : {}), href: here("calls", c?.f ?? null) },
      { key: "policy", label: "Policy", href: here("policy", c?.f ?? null) },
      { key: "history", label: "History", ...(c ? { count: c.events.length } : {}), href: here("history", c?.f ?? null) },
    ]} />
  );
  const actionsOf = (c: Case, previous: Neighbour | null, next: Neighbour | null) => {
    const { row, owners, settings, f, listHref } = c;
    return (
      <span className="inline-flex flex-wrap gap-2">
        {previous && <IntentLink transitionTypes={["nav-back"]} href={caseHref(previous.id, f, tab === "do" ? undefined : tab)} className={buttonVariants({ variant: "outline" })} title={`Previous case: ${nameOf(previous)}`}><ChevronLeft aria-hidden="true" />{nameOf(previous)}</IntentLink>}
        {next && <IntentLink transitionTypes={["nav-forward"]} href={caseHref(next.id, f, tab === "do" ? undefined : tab)} className={buttonVariants({ variant: "outline" })} title={`Next case: ${nameOf(next)}`}>{nameOf(next)}<ChevronRight aria-hidden="true" /></IntentLink>}
        <CaseActions row={row} isOwner={guard.role === "owner"} owners={owners} readOnly={readOnly} unreachableAfter={settings.unreachableAfter}
          nextHref={next ? caseHref(next.id, f) : listHref} nextName={next ? nameOf(next) : null} />
      </span>
    );
  };

  // The strip (round 7): what the progress card and the facts line said, as figures, each a link.
  const stripOf = ({ row, name }: Case) => {
    const late = row.daysLeft !== null && row.daysLeft < 0 && row.step !== "lost" && row.step !== "paperwork";
    const deadlineValue = !row.deadline || row.daysLeft === null ? "No carrier window" : late ? "Window closed" : row.daysLeft === 0 ? "Due today" : `${row.daysLeft} ${row.daysLeft === 1 ? "day" : "days"} left`;
    const premium = row.premiumCents !== null ? `${money(monthly(row.premiumCents, row.premiumMode))}/mo` : "—";
    return (
      <StatStrip label={`${name} at a glance`}>
        <StatTile label="Stage" valueSize="text" value={STEP_LABELS[row.step]} href={`/app/retention?step=${STEP_SLUG[row.step]}`}
          footnote={<StatusChip tone={row.step === "paperwork" ? "info" : row.step === "payment_problem" ? "warning" : "danger"}>{REASON_LABELS[row.reason as Reason]}</StatusChip>} />
        <StatTile label="Deadline" valueSize="text" value={deadlineValue}
          footnote={!row.deadline ? "no window configured for this carrier"
            : late ? <StatusChip tone="danger" title={`The window closed ${fileDay(row.deadline)}`}>Carrier still shows it</StatusChip>
              : row.daysLeft !== null && row.daysLeft <= 7 ? <StatusChip tone={row.daysLeft <= 3 ? "danger" : "warning"}>{fileDay(row.deadline)}</StatusChip>
                : fileDay(row.deadline)} />
        <StatTile label="Premium" valueSize="text" value={premium} href={`/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`} footnote={`${row.carrierName} ${row.policyNumber}`} />
        <StatTile label="Phone" valueSize="text" value={row.phone ? phoneText(row.phone) : "None on file"} footnote={row.phone ? "call it through the dialer" : <StatusChip tone="warning" title="Find one on the application, or ask the carrier">Find a number</StatusChip>} />
        <StatTile label="Owner" valueSize="text" value={row.ownerId === viewerId ? "You" : row.ownerName ?? "Nobody yet"} href={row.ownerId ? `/app/retention?step=${STEP_SLUG[row.step]}&owner=${row.ownerId === viewerId ? "me" : row.ownerId}` : undefined}
          footnote={row.lastContactAt ? `last call ${fileDay(row.lastContactAt.slice(0, 10))}${row.contactAttempts ? ` · ${row.contactAttempts} ${row.contactAttempts === 1 ? "try" : "tries"}` : ""}` : "not worked yet"} />
      </StatStrip>
    );
  };
  const tabOf = ({ row, events, calls, policy, draftDay, settings }: Case, reinstatement: Reinstatement | null) => {
    const latestFile = row.evidence.file_date ? String(row.evidence.file_date) : null;
    return (
      <>
        {tab === "calls" ? <CaseCalls calls={calls} />
          : tab === "policy" ? (
            // The last block grows to the foot of the screen (owner 2026-11-06: "fill the full height, no gaps").
            <section className={`${cardSurface} p-5 lg:flex-1`} aria-label="The policy">
              {policy ? (
                <dl className="m-0 grid max-w-[760px] grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-sm">
                  {([
                    // The meaning, then the carrier's own word (critique C5/C7: "approved unpaid", "IssNotPaid").
                    ["Status", STATUS_MEANING[String(policy.status_normalized)] ? capitalise(STATUS_MEANING[String(policy.status_normalized)]) : String(policy.status_normalized ?? "").replace(/_/g, " ")],
                    ["Carrier's word", policy.carrier_status_raw],
                    ["Written by", row.agentName],
                    ["Client's state", row.clientState],
                    ["Draft day", draftDay ? `The ${ordinal(draftDay)} of the month` : null],
                    ["Paid to", policy.paid_to_date ? fileDay(policy.paid_to_date) : null],
                    ["Effective", policy.effective_date ? fileDay(policy.effective_date) : null],
                    ["Premium", policy.premium_cents != null ? `${money(Number(policy.premium_cents))} ${policy.premium_mode ?? ""}`.trim() : null],
                    ["Face amount", policy.face_amount_cents != null ? `$${Math.round(Number(policy.face_amount_cents) / 100).toLocaleString("en-US")}` : null],
                    ["Pays by", policy.payment_method ? String(policy.payment_method).replace(/_/g, " ") : null],
                    ["Months paid", policy.months_paid],
                    ["Latest file", policy.last_snapshot_date ? fileDay(policy.last_snapshot_date) : null],
                  ] as Array<[string, unknown]>).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-xs font-semibold text-muted-foreground">{k}</dt><dd className="m-0 text-foreground">{String(v)}</dd></div>
                  ))}
                </dl>
              ) : <p className="m-0 text-sm text-muted-foreground">The policy isn&apos;t in the book any more.</p>}
              <Link href={`/app/policies/carrier/${row.carrierId}/${encodeURIComponent(row.policyNumber)}`} className="mt-4 inline-block text-sm font-semibold text-[var(--accent-ink)] hover:underline">Open the policy in Book of business</Link>
            </section>
          ) : tab === "history" ? (
            <TableCard className="lg:flex-1" footer={<span>Everything the files and people did on this case, newest first</span>}>
              {/* When, what, who, left to right (critique C8); a file names itself and opens the policy's file history. */}
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th className="w-[120px]">When</th><th>What</th><th className="w-[240px]">Who</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap font-medium tabular-nums text-foreground">{fileDay(e.at.slice(0, 10))}</td>
                      {/* One line per row (owner 2026-11-11): a long note is the cell's tooltip. */}
                      <td className="max-w-[640px] truncate" title={`${EVENT_TEXT[e.kind] ?? e.kind}${describe(e.kind, e.payload)}`}>{EVENT_TEXT[e.kind] ?? e.kind}{describe(e.kind, e.payload)}</td>
                      <td className="whitespace-nowrap">{e.by ?? (e.payload.by === "file"
                        ? <Link href={carrierPolicyHref(row.carrierId, row.policyNumber, "history")} className="text-foreground underline-offset-2 hover:underline">{row.carrierName} file{row.evidence.file_date ? ` of ${fileDay(String(row.evidence.file_date))}` : ""}</Link>
                        : e.payload.by === "person" ? "A person" : "Insurvas")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          ) : <WhatToDo row={row} reinstatement={reinstatement} readOnly={readOnly} unreachableAfter={settings.unreachableAfter}
            ifNothing={`${whyLine(row.reason as Reason, row.evidence)}. ${ifNothing(row.step, row.deadline, row.daysLeft, latestFile)}`} />}
      </>
    );
  };

  return (
    <RetentionPage
      step="cases"
      title={<RecordTitle read={read} name={(c) => c?.name ?? null} />}
      // The trail's Cases leads back to the list it came from (`?from=`), known from the address.
      breadcrumbs={[{ label: "Retention" }, { label: "Cases", href: query.from ? `/app/retention?${query.from}` : "/app/retention" }, { label: "Case" }]}
      tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{tabsOf}</Await></Suspense>}
      actions={<Suspense fallback={null}><Await read={both}>{([c, m]) => (c && m ? actionsOf(c, m.previous, m.next) : null)}</Await></Suspense>}
    >
      <StreamSection shape="strip">
        <Await read={read}>{(c) => stripOf(found(c))}</Await>
      </StreamSection>
      <StreamSection shape={tab === "do" ? "cards" : tab === "policy" ? "form" : "table"}>
        {tab === "do"
          ? <Await read={both}>{([c, m]) => tabOf(found(c), m?.reinstatement ?? null)}</Await>
          : <Await read={read}>{(c) => tabOf(found(c), null)}</Await>}
      </StreamSection>
    </RetentionPage>
  );
}

type Case = NonNullable<Awaited<ReturnType<typeof loadCase>>> & { settings: Awaited<ReturnType<typeof loadLadderSettings>>; f: ListFilters; open: boolean; name: string; listHref: string };
type Neighbour = Extract<Awaited<ReturnType<typeof loadLadder>>, { available: true }>["open"][number];
type Reinstatement = NonNullable<Extract<Awaited<ReturnType<typeof loadReinstatementCase>>, { available: true }>["row"]>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describe(kind: string, p: Record<string, any>): string {
  if (kind === "opened") return `: ${STEP_LABELS[p.step as Step] ?? p.step}, ${REASON_LABELS[p.reason as Reason] ?? p.reason}${p.note ? ` · ${p.note}` : ""}`;
  if (kind === "step_moved") return `: ${STEP_LABELS[p.from as Step] ?? p.from} → ${STEP_LABELS[p.to as Step] ?? p.to}${p.reason ? ` (${REASON_LABELS[p.reason as Reason] ?? p.reason})` : ""}`;
  if (kind === "evidence") return p.deadline ? `: deadline ${fileDay(p.deadline)}` : "";
  if (kind === "call") return `: ${String(p.outcome ?? "").replace(/_/g, " ")}${p.note ? ` · ${p.note}` : ""}`;
  if (kind === "fix") return `: ${String(p.kind ?? "").replace(/_/g, " ")}${p.note ? ` · ${p.note}` : ""}`;
  if (kind === "note") return p.note ? `: ${p.note}` : "";
  if (kind === "resolved") return `: ${String(p.status ?? "").replace(/_/g, " ")}${p.reason ? ` · ${p.reason}` : ""}`;
  return "";
}
