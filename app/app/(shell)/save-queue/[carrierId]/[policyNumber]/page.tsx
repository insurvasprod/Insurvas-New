import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { MISSING_LABELS, SIGNAL_LABELS, SIGNALS, type Signal } from "@/lib/retention/constants";
import { loadSaveCard, type CardState } from "@/lib/retention/queueStore";
import { REQUEST_FOR_FIX, REQUEST_LABELS, STATUS_LABELS, type RequestType } from "@/lib/retention/servicing";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { CallsTab, FixTab, IncomeTab, SaveCardActions } from "@/components/app/retention/save-card";
import { cardSurface } from "@/components/ui/card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Retention › Save queue › a card (LA-5.3; the pick of 2026-11-05, "SqA": queue → call page). The title is the
 * client, the risk as a prediction chip and one line of facts; Start the fix and Log call, and More (snooze or
 * dismiss, income, the policy). Tabs: Why (the opening line, the fixes, every signal and what it added),
 * Fix (the servicing request, in place), Calls (log one; every earlier one) and Income (LA-5.10).
 *
 * Same gates as the queue. A card off the queue (just worked, snoozed, past due, held out) still opens, and
 * its chip says why; a past-due or held-out policy is not worked from here. Opening it writes nothing.
 */
type Tab = "why" | "fix" | "calls" | "income";
const TABS: Tab[] = ["why", "fix", "calls", "income"];
const money = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const BAND_TONE: Record<string, StatusTone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const STATE_TEXT: Record<CardState, string | null> = {
  on_queue: null,
  emergency: "Past due: work it on Lapse risk",
  holdout: "Held out on purpose (the holdout)",
  held: "Snoozed or dismissed",
  worked: "Worked: off the queue for the cooldown",
  low_confidence: "Off the queue: too little known",
  below_band: "Below the queue's threshold",
};

export default async function SaveCardPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<{ tab?: string; fix?: string }> }) {
  const [guard, servicing, { carrierId, policyNumber: rawNumber }, query] = await Promise.all([guardPage("chargeback_radar"), guardPage("payment_repair"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Save queue" description="Policies paying fine today that the radar says will stop, with the reason and the fix." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Save queue" detail="Only owners, producers and retention reps can view retention risk and the advance at risk." />;
  const policyNumber = decodeURIComponent(rawNumber);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) notFound();
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope: await scopeFor(guard.context) };
  const page = await loadSaveCard(viewer, carrierId, policyNumber);
  if (!page) notFound();
  const { card, state, calls } = page;
  const readOnly = guard.entitlement.access === "read_only";
  const canWork = state !== "emergency" && state !== "holdout";
  const canStartFix = servicing.entitled && servicing.entitlement.access !== "read_only";
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "why";
  const name = card.clientName ? personName(card.clientName) : "No client linked";
  const base = `/app/save-queue/${carrierId}/${encodeURIComponent(policyNumber)}`;
  // A fix the carrier can be asked for, and not already asked (one open request of a kind per policy).
  const fixes = card.fixes
    .map((f) => ({ action: f.action, label: f.label, type: (REQUEST_FOR_FIX as Record<string, RequestType | undefined>)[f.action] }))
    .filter((f): f is { action: typeof f.action; label: string; type: RequestType } => Boolean(f.type) && !card.openRequests.some((r) => r.type === f.type));
  const asked = fixes.find((f) => f.type === query.fix)?.type ?? null;
  const facts = [
    card.phone ? phoneText(card.phone) : "No phone",
    `${card.carrierName} ${card.policyNumber}`,
    // No month here: the Why sentence is the score's (as of its run) and names the month; today's signal can be a month on (walk 2026-11-05).
    `predicted on ${card.signalsAvailable} of 7 signals`,
    STATE_TEXT[state],
  ].filter(Boolean).join(" · ");
  const knownBy = new Map(card.contributions.map((c) => [c.signal, c]));

  return (
    <RetentionPage
      step="save"
      title={name}
      // A prediction, drawn as one: the dashed chip, never the solid status of Lapse risk's facts (Module 5, rule 1).
      chip={<StatusChip tone={BAND_TONE[card.band] ?? "neutral"} dot={false} title={`Predicted, ${card.confidence} confidence. Not something the carrier reported.`} className="border border-dashed border-current">{card.score} · {card.band[0].toUpperCase() + card.band.slice(1)}</StatusChip>}
      facts={facts}
      breadcrumbs={retentionTrail("save", name)}
      tabs={<ViewTabs label={name} value={tab} tabs={[
        { key: "why", label: "Why", href: base },
        { key: "fix", label: "Fix", count: fixes.length || null, href: `${base}?tab=fix` },
        { key: "calls", label: "Calls", count: calls.length, href: `${base}?tab=calls` },
        { key: "income", label: "Income", href: `${base}?tab=income` },
      ]} />}
      actions={<SaveCardActions card={card} canWork={canWork} canStartFix={canStartFix && fixes.length > 0} readOnly={readOnly} />}
    >
      {tab === "fix" ? (
        canStartFix && !readOnly ? <FixTab card={card} fixes={fixes} active={asked} canWork={canWork} /> : <TableCard><p className="m-0 p-5 text-sm text-muted-foreground">Servicing requests are not open on this plan.</p></TableCard>
      ) : tab === "calls" ? (
        <CallsTab card={card} calls={calls} canLog={canWork && !readOnly} />
      ) : tab === "income" ? (
        <IncomeTab card={card} readOnly={readOnly} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className={`${cardSurface} flex flex-col gap-4 p-5`} aria-label="Why, and what to do">
            <div className="grid gap-1.5">
              <h2 className="m-0 text-xs font-semibold text-muted-foreground">Why</h2>
              <p className="m-0 text-sm text-foreground">
                {card.failedFix && <span className="font-semibold text-[var(--error-ink)]">Fix not in the file: {card.failedFix}. </span>}
                {card.explanation}
              </p>
            </div>
            <div className="grid gap-1.5">
              <h2 className="m-0 text-xs font-semibold text-muted-foreground">Do</h2>
              {card.fixes.length ? (
                <ol className="m-0 grid list-none gap-2 p-0 text-sm">
                  {card.fixes.map((f, i) => {
                    const type = fixes.find((x) => x.action === f.action)?.type;
                    return (
                      <li key={f.action} className="flex items-baseline gap-3">
                        <span className="font-semibold text-[var(--accent-ink)] tabular-nums">{i + 1}</span>
                        <span className="min-w-0 flex-1 text-foreground" title={f.reason}>{f.label}</span>
                        {type && canWork && canStartFix && !readOnly ? <Link href={`${base}?tab=fix&fix=${type}`} className="shrink-0 text-xs font-semibold text-[var(--accent-ink)] hover:underline">Start this fix</Link> : null}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="m-0 text-sm text-muted-foreground">No change to ask for: a courtesy call.</p>}
              {card.openRequests.length > 0 && <p className="m-0 text-xs text-muted-foreground">With the carrier: {card.openRequests.map((r) => `${REQUEST_LABELS[r.type]} (${STATUS_LABELS[r.status].toLowerCase()})`).join(", ")}</p>}
            </div>
            <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-xs font-semibold text-muted-foreground">Worth</dt>
              <dd className="m-0 tabular-nums text-foreground">{money(card.atRiskCents) ? `${money(card.atRiskCents)} of advance still at risk` : `No advance from ${card.carrierName} on file yet`}</dd>
              <dt className="text-xs font-semibold text-muted-foreground">Next draft</dt>
              <dd className="m-0 text-foreground">{card.nextDraftDays === null ? "Not known: the draft day is known only for sales written in the app" : card.nextDraftDays === 0 ? "Today" : `In ${card.nextDraftDays} ${card.nextDraftDays === 1 ? "day" : "days"}`}</dd>
              {card.lastAttempt && <><dt className="text-xs font-semibold text-muted-foreground">Last call</dt><dd className="m-0 text-foreground">{fileDay(card.lastAttempt.at.slice(0, 10))}</dd></>}
              {page.hold && <><dt className="text-xs font-semibold text-muted-foreground">{page.hold.kind === "snooze" ? "Snoozed" : "Dismissed"}</dt><dd className="m-0 text-foreground">{page.hold.until ? `until ${fileDay(page.hold.until)}` : "until the risk rises"}{page.hold.reason ? ` · ${page.hold.reason}` : ""}</dd></>}
            </dl>
          </section>
          <TableCard footer={<span>Score {card.score}: the known signals&apos; points, rescaled over the weight they carry (version {card.weightSetVersion}).</span>}>
            <table className="portal-lead-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>What we know</th>
                  <th className="w-[80px] text-right">Added</th>
                </tr>
              </thead>
              <tbody>
                {SIGNALS.map((signal: Signal) => {
                  const known = knownBy.get(signal);
                  return (
                    <tr key={signal}>
                      <td className="text-foreground">{SIGNAL_LABELS[signal]}</td>
                      <td className={known ? "text-foreground" : "text-muted-foreground"}>{known ? known.explanation : card.missing.includes(signal) ? `Not known: ${MISSING_LABELS[signal]}` : "Not known"}</td>
                      <td className="text-right font-semibold tabular-nums">{known ? `+${known.contribution}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
        </div>
      )}
    </RetentionPage>
  );
}
