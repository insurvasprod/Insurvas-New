import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { dollars } from "@/lib/agency/constants";
import { type Statement } from "@/lib/agency/statementCore";
import { DECISION_LABEL } from "@/components/app/commissions/team-payouts/draft";
import { monthName, payMethodLabel, usDate, usDay } from "@/components/app/commissions/team-payouts/shared";
import { BasisChip } from "./money";

export type StatementRun = {
  periodStart: string; periodEnd: string; withheldCents: number; decision: string | null; decisionReason: string | null;
  paidOn: string | null; method: string | null; reference: string | null; voided: boolean; voidedAt: string | null; voidReason: string | null;
};

/** What was paid on the statement: its payout lines, as a positive figure. */
export const paidOf = (s: Statement) => Math.abs(s.payouts.reduce((sum, p) => sum + p.amountCents, 0));

/**
 * AG-1.8 · the producer statement — the document that prevents arguments (round 7, 7·1, owner 2026-11-10). Built
 * from the ledger when it is opened, so it always reconciles: closing = opening + every line. The strip says the
 * month in five figures; a void run says so in its Paid cell. The page (app/app/(shell)/producer-statements/[runId])
 * draws the title, the tabs (Policies · Adjustments · How it was paid) and the buttons; the policies table is
 * components/app/commissions/team-payouts/statement-parts.tsx.
 */
export function StatementStrip({ run, statement: s, policies }: { run: StatementRun; statement: Statement; policies: number }) {
  const voided = run.voided;
  const paid = paidOf(s);
  const next = (() => { const [y, m] = run.periodEnd.split("-").map(Number); const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); })();
  const how = [usDay(run.paidOn), payMethodLabel(run.method)?.toLowerCase(), run.reference].filter((v) => v && v !== "—").join(" · ");
  return (
    <StatStrip label="Statement">
      <StatTile label="Opening · reported" value={dollars(s.openingCents)} footnote={s.openingCents < 0 ? <>{usDay(run.periodStart)} <StatusChip tone="danger">Owed back</StatusChip></> : usDay(run.periodStart)} />
      <StatTile label="This period" value={dollars(s.movementCents)} footnote={s.movementCents < 0 ? <StatusChip tone="danger">{`${policies} ${policies === 1 ? "policy" : "policies"}`}</StatusChip> : `${policies} ${policies === 1 ? "policy" : "policies"}`} />
      <StatTile label="Withheld" value={dollars(run.withheldCents)} footnote={run.withheldCents > 0 ? run.decisionReason ?? "against what was owed" : "nothing owed from before"} reserveFootnote />
      {voided
        ? <StatTile label="Paid" valueSize="text" value={run.voidedAt ? `Void ${usDay(run.voidedAt)}` : "Void"} footnote={run.voidReason ?? "voided"} />
        : <StatTile label="Paid" value={dollars(paid)} footnote={run.paidOn ? how : "nothing was paid this month"} reserveFootnote />}
      <StatTile label="Carried forward" value={dollars(s.closingCents)} footnote={s.closingCents < 0 ? <StatusChip tone="danger">{`Owed back, into ${monthName(next)}`}</StatusChip> : `to ${monthName(next)}`} />
    </StatStrip>
  );
}

/** Adjustments: what was added or taken off by hand, with its reason. */
export function StatementAdjustments({ statement: s }: { statement: Statement }) {
  return (
    <TableCard>
      {s.adjustments.length === 0 ? <EmptyState title="No adjustments this month" hint="An adjustment made to this person's balance in the period shows here, with its reason." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="w-[24%] text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {s.adjustments.map((a) => <TableRow key={a.id}><TableCell className="font-medium">{a.reason || "Adjustment"}</TableCell><TableCell className="whitespace-nowrap text-right tabular-nums">{dollars(a.amountCents)}<BasisChip basis={a.basis} /></TableCell></TableRow>)}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

/** How it was paid: the run's method, day and reference, and its payout lines. `own`: the producer reading his own. */
export function StatementPayment({ run, statement: s, agency, own }: { run: StatementRun; statement: Statement; agency: string; own: boolean }) {
  const rows: Array<[string, string]> = [
    ["Paid on", run.voided ? `Void${run.voidedAt ? ` ${usDate(run.voidedAt)}` : ""}${run.voidReason ? ` · ${run.voidReason}` : ""}` : run.paidOn ? usDate(run.paidOn) : "Nothing was paid this month"],
    ["How", payMethodLabel(run.method) ?? "—"],
    ["Reference", run.reference ?? "—"],
    ["What happened to what was owed", run.decision ? DECISION_LABEL[run.decision] ?? run.decision : "—"],
    ["From", agency],
  ];
  return (
    <TableCard>
      <Table>
        <TableBody>
          {rows.map(([k, v]) => <TableRow key={k}><TableCell className="w-[32%] font-medium">{k}</TableCell><TableCell>{v === "—" ? <span className="text-muted-foreground">—</span> : v}</TableCell></TableRow>)}
          {s.payouts.map((p) => <TableRow key={p.id}><TableCell className="font-medium">{own ? "Paid to you" : "Paid out"}</TableCell><TableCell className="whitespace-nowrap tabular-nums">{dollars(p.amountCents)}<BasisChip basis={p.basis} /></TableCell></TableRow>)}
        </TableBody>
      </Table>
    </TableCard>
  );
}
