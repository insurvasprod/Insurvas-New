"use client";

import Link from "next/link";

import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { ENTRY_LABELS, type Basis } from "@/lib/agency/statementCore";
import { dollars } from "@/lib/agency/constants";
import { BasisChip, Money } from "./money";
import { useAgencyData } from "./use-agency-data";

type Balance = { basis: Basis; balanceCents: number; earnedCents: number; chargebackCents: number; paidCents: number };
type Entry = { id: string; entryType: string; basis: Basis; policyNumber: string | null; carrierName: string | null; clientName: string | null; amountCents: number; occurredOn: string; reason: string | null };
type Run = { id: string; periodStart: string; periodEnd: string; status: string; netCents: number; withheldCents: number; paidOn: string | null };
type MoneyData = { balances: Balance[]; entries: Entry[]; runs: Run[] };

/**
 * AG-1.5 / AG-1.8 · a producer's money: his balance by basis (never blended), every ledger entry with its basis,
 * and every statement. A negative balance is normal and shown in red, never clamped. Used by the producer detail
 * page (owner, admin, bookkeeper; not a manager) and by My pay (the producer himself).
 */
export function ProducerMoneyTab({ url, statementBase = "/app/producer-statements" }: { url: string; statementBase?: string }) {
  const { data, error, loading } = useAgencyData<MoneyData>(url);
  if (error) return <ErrorState detail={error} />;
  if (loading || !data) return <SectionLoading rows={6} columns={5} label="Loading pay" />;
  const reported = data.balances.find((b) => b.basis === "reported");
  return (
    <div className="flex flex-col gap-4">
      <StatStrip label="Pay">
        <StatTile label="Balance · reported" labelTitle="What the agency owes (positive) or is owed (negative), from carrier statements. Payouts are made on this basis." value={reported ? dollars(reported.balanceCents) : "$0"} valueTone={reported && reported.balanceCents < 0 ? "danger" : undefined} footnote={reported && reported.balanceCents < 0 ? "Owed back to the agency" : "Reported basis"} />
        <StatTile label="Earned · reported" value={dollars(reported?.earnedCents ?? 0)} />
        <StatTile label="Charged back · reported" value={dollars(reported?.chargebackCents ?? 0)} valueTone={(reported?.chargebackCents ?? 0) < 0 ? "danger" : undefined} />
        <StatTile label="Paid out" value={dollars(-(reported?.paidCents ?? 0))} />
      </StatStrip>
      <TableCard title="Statements" description="Each one lists the policies behind the money, line by line.">
        {data.runs.length === 0 ? <EmptyState title="No statements yet" hint="A statement appears here each time the agency runs payouts." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Withheld</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.periodStart} – {r.periodEnd}</TableCell>
                  <TableCell><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? `Paid ${r.paidOn ?? ""}` : "Published"}</StatusChip></TableCell>
                  <TableCell className="text-right"><Money cents={r.netCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={r.withheldCents} /></TableCell>
                  <TableCell className="text-right"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`${statementBase}/${r.id}`}>Open statement</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      <TableCard title="Ledger" description="Every entry, oldest first. A correction is a new entry, never an edit.">
        {data.entries.length === 0 ? <EmptyState title="No entries yet" hint="Entries appear as carrier statements are posted." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead>Client</TableHead><TableHead>Carrier</TableHead><TableHead>Policy</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.entries.slice().reverse().map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{e.occurredOn}</TableCell>
                  <TableCell>{ENTRY_LABELS[e.entryType] ?? e.entryType}<BasisChip basis={e.basis} />{e.reason && <div className="text-xs text-[var(--muted)]">{e.reason}</div>}</TableCell>
                  <TableCell>{e.clientName ?? "—"}</TableCell>
                  <TableCell>{e.carrierName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.policyNumber ?? "—"}</TableCell>
                  <TableCell className="text-right"><Money cents={e.amountCents} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
