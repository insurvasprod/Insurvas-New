import Link from "next/link";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { ENTRY_LABELS, type EntryType } from "@/lib/ingestion/commissionLedger";
import type { PolicyMoney } from "@/lib/ingestion/commissionLedgerStore";
import { fileDay } from "@/lib/ingestion/constants";
import { FINDING_WORDS, FINDINGS_PENDING_MESSAGE, type PolicyFinding } from "@/lib/ingestion/policyPageStore";
import { rowHref } from "@/lib/ingestion/trace";

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "Unknown" : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

type Expected = { available: boolean; rows: Array<Record<string, unknown>> };

/**
 * Policy › Commissions (canvas board BobE6b): expected · reported · charged back · at risk, every ledger line
 * with the file and line it came from, the open findings (each opens Needs you), and a warning while a
 * chargeback is likely. Add the rate goes to the Rate card; Draft a letter to the discrepancy letters.
 */
export function PolicyCommissionsTab({ ledger, expected, findings, carrierName, chargebackLikely, canFix, canLetter }: {
  ledger: PolicyMoney;
  expected: Expected;
  findings: { available: boolean; items: PolicyFinding[] };
  carrierName: string;
  /** Lapsed or behind inside the clawback window with an advance still unearned. */
  chargebackLikely: boolean;
  /** Owner and bookkeeper: Add the rate (as the Rate card). */
  canFix: boolean;
  /** Owner and bookkeeper on the discrepancy report: Draft a letter. */
  canLetter: boolean;
}) {
  if (!ledger.available) return <EmptyState title="The commission ledger isn't available yet" hint="The commission ledger needs a database update (20261008220000)." />;
  const first = expected.available ? (expected.rows[0] as Record<string, unknown> | undefined) : undefined;
  const noRate = first?.confidence === "no_rate_card";
  const totals = ledger.totals;
  const atRisk = ledger.unearned?.atRiskCents ?? null;
  const reportedCents = totals ? totals.advancedCents + totals.earnedCents : null;
  const lines = ledger.entries;
  const rows = [
    ...lines.map((entry) => ({ kind: "line" as const, key: entry.id, date: entry.transactionDate ?? entry.statementDate ?? entry.createdAt, entry })),
    ...findings.items.map((finding) => ({ kind: "finding" as const, key: finding.id, date: finding.lastSeenAt ?? "", finding })),
  ];

  return (
    <>
      <StatStrip label="This policy's commission">
        <StatTile
          label="Expected"
          value={!expected.available ? "Unknown" : !first ? "—" : noRate ? "Unknown" : money(Number(first.expected_amount_cents))}
          footnote={!expected.available ? "needs a database update (20261008230000)" : !first ? "nothing expected yet" : noRate ? String(first.reason ?? "no rate on the Rate card") : `${Number(first.rate_bp_applied) / 100}% · ${first.commission_trigger === "on_issue" ? "on issue" : "on first draft"} · rate card`}
        />
        <StatTile label="Reported" value={totals ? money(reportedCents) : "—"} footnote={totals ? "advance and earned, from the statements" : "no commission line yet"} />
        <StatTile label="Charged back" value={totals ? money(Math.abs(totals.chargedBackCents)) : "—"} footnote={chargebackLikely ? "chargeback likely" : undefined} />
        <StatTile label="At risk" value={ledger.unearned ? money(atRisk) : "—"} valueTone={atRisk ? "danger" : undefined} footnote={ledger.unearned ? "unearned advance" : "no advance on record"} />
      </StatStrip>

      <PagedTableCard
        total={rows.length}
        noun="lines"
        title="Lines"
        action={(canFix || (canLetter && findings.items.length > 0)) ? (
          <div className="flex flex-wrap items-center gap-2">
            {canFix && <Button asChild variant="outline"><Link href="/app/rate-card">Add the rate</Link></Button>}
            {canLetter && findings.items.length > 0 && <Button asChild variant="outline"><Link href="/app/discrepancies">Draft a letter</Link></Button>}
          </div>
        ) : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No commission lines yet" hint={`Lines appear once ${carrierName}'s commission statements that name this policy are read.`} />
        ) : (
          <table className="portal-lead-table w-full min-w-[680px] text-left text-sm">
            <thead><tr><th className="w-[110px]">Date</th><th className="w-[200px]">Type</th><th className="w-[130px] text-right">Amount</th><th>From</th><th className="w-[110px]"><span className="sr-only">Open</span></th></tr></thead>
            <PagedBody>
              {rows.map((row) => row.kind === "line" ? (
                <tr key={row.key}>
                  <td className="tabular-nums text-muted-foreground">{fileDay(row.date)}</td>
                  <td>{row.entry.type === "reversal" && row.entry.correctsType ? `Reversal of ${(ENTRY_LABELS[row.entry.correctsType as EntryType]?.label ?? row.entry.correctsType).toLowerCase()}` : ENTRY_LABELS[row.entry.type as EntryType]?.label ?? row.entry.type.replaceAll("_", " ")}{row.entry.payeeLevel === "upline" ? <span className="text-muted-foreground"> · upline</span> : null}</td>
                  <td className={`text-right font-semibold tabular-nums ${row.entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{money(row.entry.amountCents)}</td>
                  <td className="max-w-[340px] truncate"><Link href={rowHref(row.entry.fileId, row.entry.rowNumber)} className="text-[var(--accent-ink)] hover:underline" title={row.entry.reversalReason ?? undefined}>{row.entry.fileName ?? "The file"} · line {row.entry.rowNumber}</Link></td>
                  <td />
                </tr>
              ) : (
                <tr key={row.key}>
                  <td className="tabular-nums text-muted-foreground">{fileDay(row.date || null)}</td>
                  <td><StatusChip tone={row.finding.severity === "action" ? "danger" : "warning"}>{FINDING_WORDS[row.finding.type] ?? row.finding.type.replaceAll("_", " ")}{row.finding.differenceCents ? ` ${money(Math.abs(row.finding.differenceCents))}` : ""}</StatusChip></td>
                  <td className="text-right tabular-nums text-muted-foreground">{row.finding.reportedCents === null ? "—" : money(row.finding.reportedCents)}</td>
                  <td className="max-w-[340px] truncate text-muted-foreground" title={row.finding.explanation ?? undefined}>{row.finding.explanation ?? "Against your rate card"}</td>
                  <td className="text-right"><Link href="/app/needs-you" className="font-medium text-[var(--accent-ink)] hover:underline">Open item</Link></td>
                </tr>
              ))}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>

      {ledger.unearned && (
        <p className="m-0 text-xs text-muted-foreground">
          {ledger.unearned.reason
            ? `At risk is unknown: ${ledger.unearned.reason}.`
            : `How the risk is worked out: advance ${money(ledger.unearned.advancedCents)} over ${ledger.unearned.months} months (from the ${ledger.unearned.monthsSource}${ledger.rule ? `, ${ledger.rule.productCode} from ${fileDay(ledger.rule.effectiveFrom)}` : ""}), ${ledger.unearned.clawbackType === "full" ? "charged back in full until it is earned" : "earned month by month"}. Months paid: ${ledger.unearned.monthsPaid}.`}
        </p>
      )}
      {!findings.available && <p className="m-0 text-xs text-muted-foreground">{FINDINGS_PENDING_MESSAGE}</p>}

      {chargebackLikely && atRisk ? (
        <Callout tone="warning" title={`Inside the clawback window: ${carrierName} will likely take back ${money(atRisk)}.`}>
          Nothing to do yet; it shows here when it arrives.
        </Callout>
      ) : null}
    </>
  );
}
