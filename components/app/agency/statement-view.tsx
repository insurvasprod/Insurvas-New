import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { dollars, bpsToPercent } from "@/lib/agency/constants";
import { premiumLabel, type Statement } from "@/lib/agency/statementCore";
import { BasisChip, Money } from "./money";

export type StatementRun = { withheldCents: number; decisionReason: string | null };

/**
 * AG-1.8 · the producer statement — the document that prevents arguments. Built from the ledger when it is opened,
 * so it always reconciles: closing = opening + every line. Every line shows its basis. Client name and policy
 * number only. The page (app/app/(shell)/producer-statements/[runId]) reads it on the server and draws the header:
 * the period as the title, the producer and how it was paid as the facts line, Download PDF.
 */
export function StatementView({ run, statement: s }: { run: StatementRun; statement: Statement }) {
  return (
    <>
      <StatStrip label="Statement">
        <StatTile label="Opening · reported" value={dollars(s.openingCents)} valueTone={s.openingCents < 0 ? "danger" : undefined} />
        <StatTile label="This period" value={dollars(s.movementCents)} valueTone={s.movementCents < 0 ? "danger" : undefined} />
        <StatTile label="Withheld" value={dollars(run.withheldCents)} footnote={run.withheldCents > 0 ? run.decisionReason ?? "Against a negative balance" : undefined} reserveFootnote />
        <StatTile label="Carried forward" value={dollars(s.closingCents)} valueTone={s.closingCents < 0 ? "danger" : undefined} footnote={s.closingCents < 0 ? "Owed back to the agency" : undefined} reserveFootnote />
      </StatStrip>
      <TableCard title="Policies">
        {s.lines.length === 0 ? <EmptyState title="No policy movements in this period" hint="Only payouts or adjustments moved this period; they are listed below." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead><TableHead>Carrier</TableHead><TableHead>Policy</TableHead><TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Your level</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Chargeback</TableHead><TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.client}</TableCell>
                  <TableCell>{l.carrier}</TableCell>
                  <TableCell className="font-mono text-xs">{l.policy}</TableCell>
                  <TableCell className="text-right tabular-nums">{premiumLabel(l.premiumCents, l.premiumMode)}</TableCell>
                  <TableCell className="text-right tabular-nums">{bpsToPercent(l.levelBps)}</TableCell>
                  <TableCell className="text-right">{l.grossCents === null ? "—" : <Money cents={l.grossCents} />}</TableCell>
                  <TableCell className="text-right">{l.chargebackCents === null ? "—" : <Money cents={l.chargebackCents} />}</TableCell>
                  <TableCell className="text-right"><Money cents={l.netCents} /><BasisChip basis={l.basis} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {(s.adjustments.length > 0 || s.payouts.length > 0) && (
        <TableCard title="Adjustments and payouts">
          <Table>
            <TableBody>
              {s.adjustments.map((a) => <TableRow key={a.id}><TableCell>Adjustment — {a.reason}</TableCell><TableCell className="text-right"><Money cents={a.amountCents} /><BasisChip basis={a.basis} /></TableCell></TableRow>)}
              {s.payouts.map((p) => <TableRow key={p.id}><TableCell>Paid to you</TableCell><TableCell className="text-right"><Money cents={p.amountCents} /><BasisChip basis={p.basis} /></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </>
  );
}
