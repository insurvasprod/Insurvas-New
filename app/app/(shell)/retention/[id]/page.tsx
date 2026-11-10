import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { REASON_LABELS, STEP_LABELS, stepNumber, type Reason, type Step } from "@/lib/retention/cases/ladder";
import { loadCase, monthly } from "@/lib/retention/cases/store";
import { loadCase as loadReinstatementCase } from "@/lib/retention/reinstatementStore";
import { carrierPolicyHref } from "@/lib/ingestion/policyPage";
import { loadLadderSettings } from "@/lib/retention/cases/sync";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { CaseActions, CaseCalls, WhatToDo } from "@/components/app/retention/case-view";
import { deadlineText, STATUS_MEANING, STEP_INK, whyLine } from "@/components/app/retention/ladder-mark";
import { cardSurface } from "@/components/ui/card";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Cases › a case (pick A, owner 2026-11-05; docs/retention/SPEC.md). The header: the client, the step
 * and the deadline, one line of facts, this step's next action and More. Under it the ladder strip: where the
 * case is, the steps the files moved it through, and what happens if nothing is done. Tabs: What to do (the
 * step's playbook, in place), Calls, Policy (from Book of business), History. Opening it writes nothing.
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

/** What happens next if nothing is done, in words. */
function ifNothing(step: Step, deadline: string | null): string {
  // No carrier window means no date: say what happens, never invent when.
  const unpaid = deadline ? `If it is still unpaid on ${fileDay(deadline)}` : "If it stays unpaid";
  if (step === "payment_problem") return `${unpaid}, it becomes a pending lapse.`;
  if (step === "pending_lapse") return `${unpaid}, the policy lapses.`;
  if (step === "lapsed_reinstatable") return `If it isn't reinstated${deadline ? ` by ${fileDay(deadline)}` : ""}, it is lost for good.`;
  if (step === "lost") return "Close it to win-back; the client is called again after the cooling-off.";
  return "Clear it before it blocks the policy.";
}

export default async function RetentionCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [guard, { id }, query] = await Promise.all([guardPage("chargeback_radar"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Retention" description="Every policy the carrier files flag, at its risk point, with what to do." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Retention" detail="Only owners, producers and retention reps work retention cases." />;
  if (!isRecordUuid(id)) notFound();
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const [loaded, settings] = await Promise.all([loadCase(viewer, id), loadLadderSettings(guard.context.tenantId)]);
  if (!loaded) notFound();
  const { row, events, calls, policy, owners, reinstatementId, draftDay } = loaded;
  // Step 3 works the reinstatement here (critique D1): its row, read the way its own page read it.
  const reinstatement = row.step === "lapsed_reinstatable" && reinstatementId && (query.tab ?? "do") === "do"
    ? await loadReinstatementCase(viewer, reinstatementId).then((r) => (r.available ? r.row : null)).catch(() => null)
    : null;
  const readOnly = guard.entitlement.access === "read_only";
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "do";
  const name = row.clientName ? personName(row.clientName) : "No client linked";
  const base = `/app/retention/${row.id}`;
  const at = stepNumber(row.step);
  // Under the name, one short line: how to reach them and which policy (owner 2026-11-06: "a lot of text there").
  // The owner and the work done moved to the case's facts; the step and the deadline are the progress bar below.
  const facts = (
    <>
      {row.phone
        ? <span className="select-all font-semibold tabular-nums text-foreground">{phoneText(row.phone)}</span>
        : <span className="text-[var(--warning-ink)]">No phone on file</span>}
      {" · "}{[`${row.carrierName} ${row.policyNumber}`, row.premiumCents !== null ? `${money(monthly(row.premiumCents, row.premiumMode))}/mo` : null].filter(Boolean).join(" · ")}
    </>
  );
  const due = deadlineText(row.daysLeft, row.deadline);
  const dueTone = row.daysLeft !== null && row.daysLeft <= 3 ? "text-[var(--error-ink)]" : row.daysLeft !== null && row.daysLeft <= 7 ? "text-[var(--warning-ink)]" : "text-foreground";
  const tone = STEP_INK[row.step];

  return (
    <RetentionPage
      step="cases"
      title={name}
      facts={facts}
      breadcrumbs={retentionTrail("cases", name)}
      tabs={<ViewTabs label={name} value={tab} tabs={[
        { key: "do", label: "What to do", href: base },
        { key: "calls", label: "Calls", count: calls.length, href: `${base}?tab=calls` },
        { key: "policy", label: "Policy", href: `${base}?tab=policy` },
        { key: "history", label: "History", count: events.length, href: `${base}?tab=history` },
      ]} />}
      actions={<CaseActions row={row} isOwner={guard.role === "owner"} owners={owners} readOnly={readOnly} onDoTab={tab === "do" || tab === "calls"} />}
    >
      {/* The progress bar (owner 2026-11-06): the four risk points as one bar filled up to this case's, the deadline
          on the right, and one line under it: why it is here, and what happens if nothing is done. The step and
          the deadline used to be chips beside the name; the path the files took is on History. */}
      <section className={`${cardSurface} flex flex-col gap-3 px-5 py-4`} aria-label="Where it is on the ladder">
        {/* Only this case's own stage (owner 2026-11-06: "just show the exact stage"), never the steps it isn't on. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label={at ? `Stage: ${STEP_LABELS[row.step]}` : "Paperwork"}>
          <span className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <span className="text-sm font-semibold" style={{ color: at ? tone : "var(--info-ink)" }}>{at ? STEP_LABELS[row.step] : "Paperwork"}</span>
            <span aria-hidden="true" className="block h-1.5 rounded-full" style={{ background: at ? tone : "var(--info-ink)" }} />
          </span>
          {due && <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${dueTone}`}>{due}</span>}
        </div>
        <p className="m-0 text-sm text-foreground">
          <span className="font-semibold">{whyLine(row.reason as Reason, row.evidence)}.</span>{" "}
          <span style={{ color: row.step === "lost" || row.step === "paperwork" ? undefined : tone }}>{ifNothing(row.step, row.deadline)}</span>
        </p>
      </section>

      {tab === "calls" ? <CaseCalls row={row} calls={calls} unreachableAfter={settings.unreachableAfter} readOnly={readOnly} />
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
                    <td className="tabular-nums">{fileDay(e.at.slice(0, 10))}</td>
                    <td className="whitespace-normal">{EVENT_TEXT[e.kind] ?? e.kind}{describe(e.kind, e.payload)}</td>
                    <td className="truncate">{e.by ?? (e.payload.by === "file"
                      ? <Link href={carrierPolicyHref(row.carrierId, row.policyNumber, "history")} className="text-foreground underline-offset-2 hover:underline">{row.carrierName} file{row.evidence.file_date ? ` of ${fileDay(String(row.evidence.file_date))}` : ""}</Link>
                      : "Insurvas")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        ) : <WhatToDo row={row} reinstatement={reinstatement} readOnly={readOnly} />}
    </RetentionPage>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describe(kind: string, p: Record<string, any>): string {
  if (kind === "opened") return `: ${STEP_LABELS[p.step as Step] ?? p.step}, ${REASON_LABELS[p.reason as Reason] ?? p.reason}`;
  if (kind === "step_moved") return `: ${STEP_LABELS[p.from as Step] ?? p.from} → ${STEP_LABELS[p.to as Step] ?? p.to}${p.reason ? ` (${REASON_LABELS[p.reason as Reason] ?? p.reason})` : ""}`;
  if (kind === "evidence") return p.deadline ? `: deadline ${fileDay(p.deadline)}` : "";
  if (kind === "call") return `: ${String(p.outcome ?? "").replace(/_/g, " ")}${p.note ? ` · ${p.note}` : ""}`;
  if (kind === "fix") return `: ${String(p.kind ?? "").replace(/_/g, " ")}${p.note ? ` · ${p.note}` : ""}`;
  if (kind === "note") return p.note ? `: ${p.note}` : "";
  if (kind === "resolved") return `: ${String(p.status ?? "").replace(/_/g, " ")}${p.reason ? ` · ${p.reason}` : ""}`;
  return "";
}
