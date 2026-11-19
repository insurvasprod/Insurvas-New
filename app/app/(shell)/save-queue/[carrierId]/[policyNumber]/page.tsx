import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import { MISSING_LABELS, SIGNAL_LABELS, SIGNALS, type Signal } from "@/lib/retention/constants";
import { loadSaveCard } from "@/lib/retention/queueStore";
import { REQUEST_FOR_FIX, REQUEST_LABELS, STATUS_LABELS, type RequestType } from "@/lib/retention/servicing";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import { CallsTab, FixTab, IncomeTab, SaveCardActions } from "@/components/app/retention/save-card";
import { cardSurface } from "@/components/ui/card";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
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
const BAND_TONE: Record<string, StatusTone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };

export default async function SaveCardPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<{ tab?: string; fix?: string }> }) {
  const [guard, servicing, { carrierId, policyNumber: rawNumber }, query] = await Promise.all([guardPage("chargeback_radar"), guardPage("payment_repair"), params, searchParams]);
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Save queue" description="Policies paying fine today that the radar says will stop, with the reason and the fix." />;
  if (!actAsPage(guard, ["owner", "producer", "retention"])) return <RoleGateNotice featureLabel="Save queue" detail="Only owners, producers and retention reps can view retention risk and the advance at risk." />;
  const policyNumber = decodeURIComponent(rawNumber);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 120) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  const canStartFix = servicing.entitled && servicing.entitlement.access !== "read_only";
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "why";
  const base = `/app/save-queue/${carrierId}/${encodeURIComponent(policyNumber)}`;

  /** The card's title line and tab, from the read (a missing card is a 404, said by the step). */
  const viewOf = (page: SaveCard) => {
    const { card, state, calls } = page;
    const canWork = state !== "emergency" && state !== "holdout";
    const name = card.clientName ? personName(card.clientName) : "No client linked";
    // A fix the carrier can be asked for, and not already asked (one open request of a kind per policy).
    const fixes = card.fixes
      .map((f) => ({ action: f.action, label: f.label, type: (REQUEST_FOR_FIX as Record<string, RequestType | undefined>)[f.action] }))
      .filter((f): f is { action: typeof f.action; label: string; type: RequestType } => Boolean(f.type) && !card.openRequests.some((r) => r.type === f.type));
    const asked = fixes.find((f) => f.type === query.fix)?.type ?? null;
    const knownBy = new Map(card.contributions.map((c) => [c.signal, c]));
    return {
      name,
      // A prediction, drawn as one: the dashed chip, never the solid status of Lapse risk's facts (Module 5, rule 1).
      chip: <StatusChip tone={BAND_TONE[card.band] ?? "neutral"} dot={false} title={`Predicted, ${card.confidence} confidence. Not something the carrier reported.`} className="border border-dashed border-current">{card.score} · {card.band[0].toUpperCase() + card.band.slice(1)}</StatusChip>,
      tabs: { name, fix: fixes.length || null, calls: calls.length },
      actions: <SaveCardActions card={card} canWork={canWork} canStartFix={canStartFix && fixes.length > 0} readOnly={readOnly} />,
      body: tab === "fix" ? (
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
                    {card.failedFix && <><StatusChip tone="danger" className="mr-1.5">Fix not in the file</StatusChip>{card.failedFix}. </>}
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
                            <span className="tabular-nums text-foreground">{i + 1}</span>
                            <span className="min-w-0 flex-1 text-foreground" title={f.reason}>{f.label}</span>
                            {type && canWork && canStartFix && !readOnly ? <Link href={`${base}?tab=fix&fix=${type}`} className="shrink-0 text-foreground hover:underline" title="Start this fix">Start ›</Link> : null}
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
                          <td className="whitespace-nowrap font-medium text-foreground">{SIGNAL_LABELS[signal]}</td>
                          <td className="whitespace-nowrap">{known ? known.explanation : card.missing.includes(signal) ? `Not known: ${MISSING_LABELS[signal]}` : "Not known"}</td>
                          <td className="whitespace-nowrap text-right tabular-nums">{known ? `+${known.contribution}` : <span className="text-muted-foreground">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableCard>
            </div>
          ),
    };
  };
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the step draw at once and the name waits in a
  // title-shaped placeholder. The read starts here; the title line's parts and the tab each wait on it.
  const read = scopeFor(guard.context)
    .then((scope) => loadSaveCard({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope }, carrierId, policyNumber))
    .then((page) => (page ? viewOf(page) : null));
  const tabsOf = (counts: { name: string; fix: number | null; calls: number } | null) => (
    <ViewTabs label={counts?.name ?? "Save card"} value={tab} tabs={[
      { key: "why", label: "Why", href: base },
      { key: "fix", label: "Fix", ...(counts ? { count: counts.fix } : {}), href: `${base}?tab=fix` },
      { key: "calls", label: "Calls", ...(counts ? { count: counts.calls } : {}), href: `${base}?tab=calls` },
      { key: "income", label: "Income", href: `${base}?tab=income` },
    ]} />
  );

  return (
    <RetentionPage
      step="save"
      title={<RecordTitle read={read} name={(view) => view?.name ?? null} />}
      chip={<Suspense fallback={null}><Await read={read}>{(view) => view?.chip ?? null}</Await></Suspense>}
      breadcrumbs={retentionTrail("save", "Card")}
      tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{(view) => tabsOf(view?.tabs ?? null)}</Await></Suspense>}
      actions={<Suspense fallback={null}><Await read={read}>{(view) => view?.actions ?? null}</Await></Suspense>}
    >
      <StreamSection shape={tab === "why" ? "cards" : tab === "income" ? "strip+table" : "form"}>
        <Await read={read}>
          {(view) => {
            if (!view) notFound();
            return view.body;
          }}
        </Await>
      </StreamSection>
    </RetentionPage>
  );
}

type SaveCard = NonNullable<Awaited<ReturnType<typeof loadSaveCard>>>;
