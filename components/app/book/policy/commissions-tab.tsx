import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ENTRY_LABELS, type EntryType } from "@/lib/ingestion/commissionLedger";
import type { PolicyMoney } from "@/lib/ingestion/commissionLedgerStore";
import { FINDING_WORDS, FINDINGS_PENDING_MESSAGE, type PolicyFinding } from "@/lib/ingestion/policyPageStore";
import { barParts, cents as money, moneyFigures, monthStrip, shortDay, stripSentence, whatsNext, type MoneyFacts } from "@/lib/ingestion/policyMoney";
import { rowHref } from "@/lib/ingestion/trace";
import { cn } from "@/lib/utils";

import { ClickRow } from "./click-row";
import { MoneyBar } from "./money-bar";

type Expected = { available: boolean; rows: Array<Record<string, unknown>> };

const pct = (bp: unknown) => (bp === null || bp === undefined || !Number.isFinite(Number(bp)) ? null : `${(Number(bp) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`);
const LINK = "text-foreground hover:underline";

/**
 * Policy › Money (round 5, board 7; it was "Commissions"): how much this policy pays and whether it is safe.
 * The first year's figures (expected · advanced · earned · at risk), one bar (earned · at risk · still to
 * come) and a 12-month strip showing the paid months and the month the advance is fully earned; What's next,
 * by the carrier's grace in Carrier rules ("grace not set" when there is none, never a number of ours); and
 * every line from the carrier, each opening its file row, with a pay issue's own Review button.
 */
export function PolicyCommissionsTab({ ledger, expected, findings, carrierName, carrierId, chargebackLikely, canFix, canLetter, facts, today }: {
  ledger: PolicyMoney;
  expected: Expected;
  findings: { available: boolean; items: PolicyFinding[] };
  carrierName: string;
  carrierId: string;
  /** Lapsed or behind inside the clawback window with an advance still unearned. */
  chargebackLikely: boolean;
  /** Owner and bookkeeper: Add or change the rate (as the Rate card), set the grace (as Carrier rules). */
  canFix: boolean;
  /** Owner and bookkeeper on the discrepancy report: Draft a letter. */
  canLetter: boolean;
  /** The policy's own facts (paid-to, months paid, premium, grace); the money parts are filled here from the ledger. */
  facts: Omit<MoneyFacts, "expectedCents" | "noRate" | "advancedCents" | "earnedLineCents" | "chargedBackCents" | "unearnedCents" | "atRiskCents" | "shortCents" | "hasLines"> & { premiumCents: number | null };
  today: string;
}) {
  if (!ledger.available) return <EmptyState title="The commission ledger isn't available yet" hint="The commission ledger needs a database update (20261008220000)." />;
  const first = expected.available ? (expected.rows.find((row) => Number(row.policy_year) === 1) ?? expected.rows[0]) as Record<string, unknown> | undefined : undefined;
  const noRate = first?.confidence === "no_rate_card";
  const totals = ledger.totals;
  const trace = ledger.unearned;
  const advanceMonths = trace?.months ?? (first?.advance_months ? Number(first.advance_months) : null);
  const shortCents = findings.items.filter((f) => f.type === "short_paid" || f.type === "missing").reduce((sum, f) => sum + Math.abs(f.differenceCents ?? 0), 0);
  // An advance charged back whole is gone: nothing of it is earned, at risk or earned month by month (QA
  // 2026-11-03: after a full chargeback the tab still said "$202.50 advanced" and "the advance is earned").
  const grossAdvance = totals?.advancedCents ?? 0;
  const chargedBack = Math.min(0, totals?.chargedBackCents ?? 0);
  const takenBack = grossAdvance > 0 && grossAdvance + chargedBack <= 0;
  const lastChargeback = [...ledger.entries].reverse().find((entry) => entry.type === "chargeback");
  const full: MoneyFacts = {
    ...facts,
    expectedCents: first && !noRate && first.expected_amount_cents !== null && first.expected_amount_cents !== undefined ? Number(first.expected_amount_cents) : null,
    noRate,
    advancedCents: takenBack ? 0 : grossAdvance,
    earnedLineCents: totals?.earnedCents ?? 0,
    chargedBackCents: totals?.chargedBackCents ?? 0,
    unearnedCents: trace ? trace.unearnedCents : 0,
    atRiskCents: trace ? trace.atRiskCents : 0,
    shortCents,
    hasLines: ledger.entries.length > 0,
  };
  const figures = moneyFigures(full);
  const parts = barParts(figures);
  const strip = monthStrip({ effectiveDate: facts.effectiveDate, monthsPaid: facts.monthsPaid, advanceMonths, behind: (facts.daysPastDue ?? 0) > 0, paidTo: facts.paidTo });
  const next = whatsNext({ ...full, carrierName, premiumCents: facts.premiumCents, advanceMonths }, today);
  const firstAdvance = ledger.entries.find((entry) => entry.type === "advance");
  const atRisk = figures.atRiskCents;

  // LA-4.13: "Add the rate" only while no rate prices this policy; with one, "Change the rate", and "Check the
  // rate" when a line was paid at another rate.
  const rateAction = !expected.available ? null : !first || noRate ? "Add the rate" : findings.items.some((f) => f.type === "mis_rated") ? "Check the rate" : "Change the rate";
  const rateLine = !expected.available
    ? "expected commission needs a database update (20261008230000)"
    : !first ? "nothing expected yet: the carrier's pay trigger hasn't happened, or its trigger isn't set in Carrier terms"
    : noRate ? String(first.reason ?? "no rate on the Rate card")
    : [`rate card: ${pct(first.rate_bp_applied) ?? "—"}`, first.advance_pct_bp ? `advance ${pct(first.advance_pct_bp)}${advanceMonths ? ` over ${advanceMonths} months` : ""}` : advanceMonths ? `advanced over ${advanceMonths} months` : "no advance rule", first.commission_trigger === "on_issue" ? "paid on issue" : "paid on the first draft"].join(" · ");

  const rows = [
    ...findings.items.map((finding) => ({ kind: "finding" as const, key: finding.id, date: finding.lastSeenAt ?? "", finding })),
    ...ledger.entries.map((entry) => ({ kind: "line" as const, key: entry.id, date: entry.transactionDate ?? entry.statementDate ?? entry.createdAt, entry })),
  ];

  return (
    <>
      <StatStrip label="This policy's first year">
        <StatTile label="Expected" value={figures.expectedCents !== null ? money(figures.expectedCents) : "—"} footnote={!expected.available ? "can't be read yet" : !first ? "nothing expected yet" : noRate ? "no rate on the Rate card" : "first year, from the rate card"} />
        <StatTile label="Advanced" value={totals ? money(grossAdvance + chargedBack) : "—"} footnote={takenBack ? <StatusChip tone="warning">Charged back</StatusChip> : chargedBack < 0 ? [`${money(grossAdvance)} advanced`, `${money(-chargedBack)} charged back${lastChargeback?.transactionDate ?? lastChargeback?.statementDate ? ` ${shortDay(lastChargeback.transactionDate ?? lastChargeback.statementDate)}` : ""}`].join(" · ") : firstAdvance ? [firstAdvance.transactionDate ?? firstAdvance.statementDate ? shortDay(firstAdvance.transactionDate ?? firstAdvance.statementDate) : null, firstAdvance.fileName ?? "the statement"].filter(Boolean).join(" · ") : "no advance on record"} />
        <StatTile label="Earned" value={figures.earnedCents !== null ? money(figures.earnedCents) : "—"} footnote={takenBack ? "the advance was charged back" : figures.earnedCents === null ? "months advanced not known" : advanceMonths && facts.monthsPaid !== null && full.advancedCents > 0 ? `${Math.min(facts.monthsPaid, advanceMonths)} of ${advanceMonths} months paid` : totals ? "from the statements" : "no commission line yet"} />
        {/* Round 6: "Inside the clawback window…" was a notice on the page (no notices: owner 2026-11-02); it is this footnote now. */}
        <StatTile label="At risk" value={atRisk !== null ? money(atRisk) : "—"} footnote={atRisk === null ? trace?.reason ?? "can't be worked out" : atRisk ? <StatusChip tone={chargebackLikely ? "danger" : "warning"}>{chargebackLikely ? `likely taken back: inside the clawback window` : "taken back if it lapses"}</StatusChip> : takenBack ? "nothing left to take back" : full.advancedCents > 0 ? "the advance is earned" : "no advance to take back"} />
      </StatStrip>

      {/* Round 6 (board 5): the year and what's next side by side on a wide screen. Cards, not table cards: neither
          is a list, so neither stretches to the window's foot (§6b). */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>First year</CardTitle>
          <CardDescription>{rateLine}</CardDescription>
          {canFix && rateAction && <CardAction><Button asChild variant="outline"><Link href="/app/rate-card">{rateAction}</Link></Button></CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {parts ? (
            <div className="flex flex-col gap-2">
              <MoneyBar size="card" parts={parts} label={`${money(figures.earnedCents)} earned, ${money(atRisk)} at risk, ${money(figures.restCents)} still to come`} />
              <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span><span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-[var(--success)]" />{money(figures.earnedCents)} earned</span>
                <span><span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-[var(--warning)]" />{money(atRisk)} at risk</span>
                {figures.shortCents > 0 && <span><span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-[var(--error)]" />{money(figures.shortCents)} short</span>}
                <span><span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-[var(--surface-alt)]" />{figures.restCents !== null ? `${money(figures.restCents)} still to come` : "still to come: needs a rate"}</span>
              </p>
            </div>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Nothing to draw yet: no commission line and no rate card figure for this policy.</p>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-xs font-semibold text-muted-foreground">Month by month</h3>
            {strip ? (
              <ol className="m-0 grid list-none grid-cols-6 gap-1.5 p-0 sm:grid-cols-12" aria-label="The first year, month by month">
                {strip.map((box) => (
                  <li
                    key={box.day}
                    title={box.earnedHere ? "The advance is fully earned when this month is paid" : undefined}
                    className={cn(
                      "flex h-12 flex-col items-center justify-center rounded-md border text-xs",
                      box.state === "paid" ? "border-transparent bg-[var(--success-surface)] text-[var(--success-ink)]"
                        : box.state === "missed" ? "border-transparent bg-[var(--error-surface)] text-[var(--error-ink)]"
                        : box.state === "due" ? "border-[var(--info)] text-[var(--info-ink)]"
                        : "border-border text-muted-foreground",
                      box.earnedHere && "border-[var(--success)]",
                    )}
                  >
                    <span className="flex items-center gap-1 font-semibold">{box.label}{box.state === "paid" && <Check aria-label="paid" className="size-3" />}</span>
                    {box.note && <span>{box.note}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No effective date in the carrier&rsquo;s file, so the months can&rsquo;t be laid out.</p>
            )}
            <p className="m-0 text-sm text-[var(--body)]">{takenBack ? `The ${money(grossAdvance)} advance was charged back, so none of it is earned or at risk. If the policy is still in force, check the chargeback with ${carrierName}.` : stripSentence({ advancedCents: full.advancedCents, months: advanceMonths, clawbackType: trace?.clawbackType ?? null, effectiveDate: facts.effectiveDate, expectedCents: figures.expectedCents, reason: trace?.reason ?? null })}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What&rsquo;s next</CardTitle>
          {next.graceMissing && canFix && <CardAction><Button asChild variant="outline"><Link href={`/app/book-setup/carrier-rules?carrier=${carrierId}`}>Set the grace</Link></Button></CardAction>}
        </CardHeader>
        <CardContent>
        {next.lines.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 text-sm">
            {next.lines.map((line, index) => (
              <li key={`${line.date}-${index}`} className={line.tone === "danger" ? "text-[var(--error-ink)]" : line.tone === "warning" ? "text-[var(--warning-ink)]" : "text-foreground"}>{line.text}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">Nothing is due on this policy: it isn&rsquo;t in force.</p>
        )}
        </CardContent>
      </Card>
      </div>

      <PagedTableCard
        total={rows.length}
        noun="lines"
        title="Lines from the carrier"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canLetter && findings.items.length > 0 && <Button asChild variant="outline"><Link href="/app/discrepancies">Draft a letter</Link></Button>}
            <Link href="/app/ledger" className={LINK}>Ledger</Link>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No commission lines yet" hint={`Lines appear once ${carrierName}'s commission statements that name this policy are read.${findings.available ? "" : ` ${FINDINGS_PENDING_MESSAGE}`}`} />
        ) : (
          <table className="portal-lead-table w-full min-w-[680px] text-left text-sm">
            <thead><tr><th className="w-[110px]">Date</th><th>Line</th><th className="w-[130px] text-right">Amount</th><th>From</th><th className="w-[110px]"><span className="sr-only">Next step</span></th></tr></thead>
            <PagedBody>
              {rows.map((row) => row.kind === "line" ? (
                <ClickRow key={row.key} href={rowHref(row.entry.fileId, row.entry.rowNumber)} label={`Open line ${row.entry.rowNumber}`} chevron={false}>
                  {/* Owner 2026-11-11: one line, one colour. "Upline" is the line's tooltip; a held line says so in the
                      From column's one chip (its file and row are that chip's tooltip). */}
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{shortDay(row.date)}</td>
                  <td className="whitespace-nowrap font-medium text-foreground" title={row.entry.payeeLevel === "upline" ? "Paid to the upline" : undefined}>{row.entry.type === "reversal" && row.entry.correctsType ? `Reversal of ${(ENTRY_LABELS[row.entry.correctsType as EntryType]?.label ?? row.entry.correctsType).toLowerCase()}` : ENTRY_LABELS[row.entry.type as EntryType]?.label ?? row.entry.type.replaceAll("_", " ")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(row.entry.amountCents)}</td>
                  <td className="whitespace-nowrap" title={[row.entry.heldByStatement ? `${row.entry.fileName ?? "The file"} · row ${row.entry.rowNumber}` : null, row.entry.reversalReason].filter(Boolean).join(" · ") || undefined}>{row.entry.heldByStatement ? <StatusChip tone="warning">Held: its statement doesn&rsquo;t add up</StatusChip> : `${row.entry.fileName ?? "The file"} · row ${row.entry.rowNumber}`}</td>
                  <td className="whitespace-nowrap text-right"><Link href={rowHref(row.entry.fileId, row.entry.rowNumber)} aria-label={`Open line ${row.entry.rowNumber}`} className="text-foreground hover:underline">Open ›</Link></td>
                </ClickRow>
              ) : (
                <tr key={row.key}>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{shortDay(row.date || null)}</td>
                  <td className="whitespace-nowrap"><StatusChip tone={row.finding.severity === "action" ? "danger" : "warning"}>{FINDING_WORDS[row.finding.type] ?? row.finding.type.replaceAll("_", " ")}</StatusChip></td>
                  <td className="whitespace-nowrap text-right tabular-nums">{row.finding.differenceCents ? money(Math.abs(row.finding.differenceCents)) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="max-w-[320px] truncate" title={row.finding.explanation ?? undefined}>{row.finding.explanation ?? "Against your rate card"}</td>
                  <td className="whitespace-nowrap text-right"><Link href={`/app/needs-you/review?kind=money&id=${encodeURIComponent(row.finding.id)}`} className="text-foreground hover:underline">Review ›</Link></td>
                </tr>
              ))}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </>
  );
}
