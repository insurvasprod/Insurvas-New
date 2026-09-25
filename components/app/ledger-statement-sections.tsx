import Link from "next/link";

import { TableCard } from "@/components/ui/table-card";
import {
  STATEMENT_KIND_LABELS,
  statementDay,
  statementMoney,
  statementPeriod,
  type StatementLedgerEntry,
} from "@/lib/ledger/statementConstants";
import type { ReconciliationRow, ReconciliationStatus } from "@/lib/ledger/statementMatch";

/**
 * The commission ledger's statement half: what carriers REPORTED (accepted statement lines) and,
 * where a policy has both, how that compares with what the book EXPECTED.
 *
 * Kept apart from the expected entries on purpose. The expected table is a derivation — premium ×
 * a schedule row — and this one is a record: a carrier's line, the policy a person matched it to,
 * and who accepted it. A reader must never have to work out which kind of number they are looking at.
 */

const KIND_CHIP = {
  advance: "bg-[var(--info-surface)] text-[var(--info-ink)]",
  commission: "bg-[var(--success-surface)] text-[var(--success-ink)]",
  chargeback: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  adjustment: "bg-[var(--surface-alt)] text-[var(--body)]",
} as const;

const RECONCILE: Record<ReconciliationStatus, { label: string; chip: string }> = {
  agrees: { label: "Agrees", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  short: { label: "Paid short", chip: "bg-[var(--error-surface)] text-[var(--error-ink)]" },
  over: { label: "Paid over", chip: "bg-[var(--warning-surface)] text-[var(--warning-ink)]" },
  unpriced: { label: "No expected figure", chip: "bg-[var(--surface-alt)] text-[var(--body)]" },
};

const SHOWN = 200;

export function StatementEntriesTable({ entries, canOpenStatements }: { entries: StatementLedgerEntry[]; canOpenStatements: boolean }) {
  const shown = entries.slice(0, SHOWN);
  return (
    <TableCard
      title="Reported by carriers"
      description="Lines from imported statements that a person matched to a policy and accepted. Only these post."
      footer={<><span>{entries.length > SHOWN ? `Newest ${SHOWN} of ${entries.length.toLocaleString("en-US")} entries` : `${entries.length.toLocaleString("en-US")} ${entries.length === 1 ? "entry" : "entries"} · newest first`}</span><span>Every figure resolves to a row on a carrier statement</span></>}
    >
      <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
        <thead>
          <tr>
            <th className="w-[110px]">Posted</th>
            <th>Policy</th>
            <th className="w-[120px]">Kind</th>
            <th className="w-[130px] text-right">Amount</th>
            <th>Source statement</th>
            <th>Accepted by</th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {shown.map((entry) => (
            <tr key={entry.id} className="m-row">
              <td className="tabular-nums">{statementDay(entry.postedOn)}</td>
              <td>
                <span className="block font-semibold text-foreground">{entry.policyNumber}</span>
                <span className="block text-xs text-muted-foreground">{entry.insuredName}</span>
              </td>
              <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${KIND_CHIP[entry.kind]}`}>{STATEMENT_KIND_LABELS[entry.kind]}</span></td>
              <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{statementMoney(entry.amountCents)}</td>
              <td>
                {canOpenStatements ? (
                  <Link href={`/app/statements/${entry.statementId}`} className="block font-semibold text-foreground underline-offset-2 hover:underline">{entry.carrierName} · {statementPeriod(entry.periodStart, entry.periodEnd)}</Link>
                ) : (
                  <span className="block font-semibold text-foreground">{entry.carrierName} · {statementPeriod(entry.periodStart, entry.periodEnd)}</span>
                )}
                <span className="block text-xs text-muted-foreground">{entry.fileName} · row {entry.lineNumber}</span>
              </td>
              <td>
                <span className="block text-foreground">{entry.acceptedByName ?? "A former member"}</span>
                <span className="block text-xs text-muted-foreground">{statementDay(entry.acceptedAt)} · {entry.method === "manual" ? "matched by hand" : "exact match"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

export function ReconciliationTable({ rows, policies }: { rows: ReconciliationRow[]; policies: Map<string, { policyNumber: string; insuredName: string; carrierName: string }> }) {
  const needsLook = rows.filter((row) => row.status === "short" || row.status === "over").length;
  return (
    <TableCard
      title="Expected against reported"
      description="Per policy: what the carrier's accepted lines add up to, against what your book and the carrier library expect for the same statement periods."
      footer={<><span>{rows.length.toLocaleString("en-US")} {rows.length === 1 ? "policy" : "policies"} on both sides · {needsLook.toLocaleString("en-US")} {needsLook === 1 ? "differs" : "differ"} by a dollar or more</span><span>Differences first</span></>}
    >
      <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr>
            <th>Policy</th>
            <th>Periods reported</th>
            <th className="w-[130px] text-right">Expected</th>
            <th className="w-[130px] text-right">Reported</th>
            <th className="w-[130px] text-right">Difference</th>
            <th className="w-[160px]">Status</th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {rows.slice(0, SHOWN).map((row) => {
            const policy = policies.get(row.policyId);
            return (
              <tr key={row.policyId} className="m-row">
                <td>
                  <span className="block font-semibold text-foreground">{policy?.policyNumber ?? "Policy"}</span>
                  <span className="block text-xs text-muted-foreground">{policy ? `${policy.insuredName} · ${policy.carrierName}` : ""}</span>
                </td>
                <td className="text-xs text-muted-foreground">{row.periods.map((period) => statementPeriod(period.start, period.end)).join(", ")}</td>
                <td className="text-right tabular-nums">{row.status === "unpriced" ? "—" : statementMoney(row.expectedCents)}</td>
                <td className="text-right tabular-nums">{statementMoney(row.receivedCents)}</td>
                <td className={`text-right font-semibold tabular-nums ${row.status === "short" ? "text-[var(--error-ink)]" : "text-foreground"}`}>{row.status === "unpriced" ? "—" : `${row.differenceCents > 0 ? "+" : ""}${statementMoney(row.differenceCents)}`}</td>
                <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${RECONCILE[row.status].chip}`}>{RECONCILE[row.status].label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
