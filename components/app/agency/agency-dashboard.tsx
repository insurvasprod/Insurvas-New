"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/view-tabs";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { dollars } from "@/lib/agency/constants";
import { BasisChip, Money } from "./money";
import { useAgencyData } from "./use-agency-data";

type Row = {
  producerUserId: string; name: string; submitted: number; issued: number; placement: string;
  m4: { text: string; building: boolean }; advanceAtRiskCents: number; balanceCents: number | null;
};
type Alert = { producerUserId: string; name: string; item: string; detail: string; expiresOn: string; daysLeft: number };
type Dashboard = {
  period: { from: string; to: string };
  seats: { used: number; max: number | null };
  producers: Row[];
  payableOutCents: number | null;
  negativeCount: number | null;
  overrideCents: number | null;
  alerts: Alert[];
  ledgerReady: boolean;
};

function monthRange(offset: number) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

/**
 * AG-0.11 · the agency owner's home: which of my producers is actually making me money? One strip (seats, payable
 * out, the owner's override, licence alerts), one producer table carrying panels 1–3, and the health table (panel 4).
 * Under the sample a count ("6/9"), never a percentage. Every money figure says its basis.
 */
export function AgencyDashboard({ agencyName, scoped }: { agencyName: string; scoped: boolean }) {
  const [which, setWhich] = useState<"this" | "last">("this");
  const range = useMemo(() => monthRange(which === "this" ? 0 : -1), [which]);
  const { data, error, loading, refreshing, reload } = useAgencyData<Dashboard>(`/api/app/agency/dashboard?from=${range.from}&to=${range.to}`);
  const mostAtRisk = data?.producers.reduce<Row | null>((top, r) => (r.advanceAtRiskCents > (top?.advanceAtRiskCents ?? 0) ? r : top), null) ?? null;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader
        title={agencyName}
        description={scoped ? `Your reports in ${range.label}.` : `Which producers are making the agency money in ${range.label}.`}
        actions={<>
          <Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "this", label: "This month" }, { key: "last", label: "Last month" }]} />
          {!scoped && <Button asChild><Link href="/app/producers?invite=1">Invite producer</Link></Button>}
        </>}
      />
      {error ? <ErrorState detail={error} action={<Button variant="outline" onClick={reload}>Try again</Button>} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Loading the dashboard" /> : (
        <>
          <StatStrip label="Agency at a glance">
            <StatTile label="Seats" value={data.seats.max === null ? `${data.seats.used}` : `${data.seats.used} of ${data.seats.max}`} meter={data.seats.max ? { value: data.seats.used, max: data.seats.max, label: "Seats used", tone: data.seats.used >= data.seats.max ? "danger" : "primary" } : undefined} footnote={data.seats.max === null ? "No seat ceiling" : undefined} reserveFootnote />
            <StatTile label="Payable out" labelTitle="What the agency owes producers now, on the reported basis — what carriers say was paid." value={data.payableOutCents === null ? "—" : dollars(data.payableOutCents)} footnote={data.ledgerReady ? (data.negativeCount ? `${data.negativeCount} producer${data.negativeCount === 1 ? "" : "s"} negative` : "Reported basis") : "Shows once the payable ledger is live"} />
            {!scoped && <StatTile label="Your override" labelTitle="What carriers paid the agency on producers' business this period, less the producers' reported share." value={data.overrideCents === null ? "—" : dollars(data.overrideCents)} footnote="Reported basis" valueTone={data.overrideCents !== null && data.overrideCents < 0 ? "danger" : undefined} />}
            <StatTile label="Licence alerts" value={String(data.alerts.length)} valueTone={data.alerts.length ? "warning" : undefined} footnote="Expiring inside 60 days" />
          </StatStrip>

          <TableCard
            title="Producers"
            toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />}
          >
            {data.producers.length === 0 ? (
              <EmptyState title="No producers yet" hint="Invite your first producer; their production shows here from their first submission." action={scoped ? undefined : <Button asChild><Link href="/app/producers?invite=1">Invite producer</Link></Button>} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producer</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead className="text-right">Placement <InfoTip label="About placement and month-4 survival">Placement and month-4 survival show counts until there are enough policies for a percentage.</InfoTip></TableHead>
                    <TableHead className="text-right">Month-4 alive</TableHead>
                    <TableHead className="text-right">Advance at risk</TableHead>
                    <TableHead className="text-right">Balance <BasisChip basis="reported" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.producers.map((r) => (
                    <TableRow key={r.producerUserId} className={mostAtRisk?.producerUserId === r.producerUserId && r.advanceAtRiskCents > 0 ? "bg-[var(--warning-surface)]" : undefined}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.placement}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.m4.text}</TableCell>
                      <TableCell className="text-right"><Money cents={r.advanceAtRiskCents} /></TableCell>
                      <TableCell className="text-right">{data.ledgerReady ? <Money cents={r.balanceCents} /> : <span className="text-[var(--muted)]">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>

          <TableCard title="Expiring inside 60 days" description="Licences, appointments and E&O. An expiry stops that producer from submitting.">
            {data.alerts.length === 0 ? (
              <EmptyState title="Nothing expires in the next 60 days" hint="Licences, appointments and E&O certificates appear here two months before they lapse." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Producer</TableHead><TableHead>Item</TableHead><TableHead>Detail</TableHead><TableHead className="text-right">Expires</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.alerts.map((a, i) => (
                    <TableRow key={`${a.producerUserId}-${a.item}-${i}`}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.item}</TableCell>
                      <TableCell>{a.detail}</TableCell>
                      <TableCell className="text-right"><StatusChip tone={a.daysLeft <= 14 ? "danger" : "warning"}>in {a.daysLeft} day{a.daysLeft === 1 ? "" : "s"}</StatusChip></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCard>
        </>
      )}
    </div>
  );
}
