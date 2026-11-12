"use client";

import { useMemo, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { dollars } from "@/lib/agency/constants";
import { fileDay } from "@/lib/ingestion/constants";
import type { CreditPerson, CreditRow, CreditWhy } from "@/lib/agency/moneyStores";
import { ageDays, ageTone, itemHref, policyPageHref, statementRowHref, WHY_CHIP } from "./credit-core";

const LINK = "underline-offset-2 hover:underline";

/** The one person a decided row was credited to, as a plain name that links to their pay. */
function Person({ person }: { person: CreditPerson | null }) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  return person.producerId ? <Link href={`/app/producers/${person.producerId}?tab=money`} className={LINK}>{person.name}</Link> : <>{person.name}</>;
}

/**
 * Commissions › Who gets the credit, To decide and Decided (round 7 direction A, docs/la4/mockups-r7/commissions.html
 * 3·A): one row per statement line, naming both producers who could get it, so most items are decided by reading
 * the row and pressing one choice on its page. A row opens the item's page; its names, policy and amount link on.
 */
export function CreditQueue({ rows, decided = false, today }: { rows: CreditRow[]; decided?: boolean; today: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [why, setWhy] = useState<CreditWhy | "">("");
  const [carrier, setCarrier] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);

  const carriers = useMemo(() => {
    const names = new Map(rows.filter((r) => r.carrierId).map((r) => [r.carrierId as string, r.carrierName ?? "Carrier not known"]));
    return [{ value: "", label: "All carriers" }, ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [rows]);
  const needle = query.trim().toLowerCase();
  const matches = (r: CreditRow) => !needle || [r.policyNumber, r.clientName, r.writingNumber?.name, r.application?.name, r.resolved?.name, r.agentIdentifier].some((v) => v?.toLowerCase().includes(needle));
  const base = rows.filter((r) => matches(r) && (!carrier || r.carrierId === carrier));
  const count = (key: CreditWhy) => base.filter((r) => r.why === key).length;
  const shownRows = base.filter((r) => !why || r.why === why);
  const shown = paginate(shownRows, page, pageSize);
  const waiting = shownRows.reduce((sum, r) => sum + r.amountCents, 0);
  const filtered = Boolean(needle || why || carrier);
  const clear = () => { setQuery(""); setWhy(""); setCarrier(""); setPage(1); };

  const openRow = (href: string) => (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    router.push(href);
  };
  const policyCell = (r: CreditRow) => (r.policyNumber && r.carrierId
    ? <Link href={policyPageHref(r.carrierId, r.policyNumber)} className={LINK}>{r.policyNumber}</Link>
    : (r.policyNumber ?? <span className="text-muted-foreground">—</span>));
  const amountCell = (r: CreditRow) => (r.fileId && r.rowNumber !== null
    ? <Link href={statementRowHref(r.fileId, r.rowNumber)} className={`tabular-nums ${LINK}`} title="The statement line">{dollars(r.amountCents)}</Link>
    : <span className="tabular-nums">{dollars(r.amountCents)}</span>);

  const toolbar = (
    <DataToolbar actions={<>
      {!decided && <span className="text-sm text-foreground"><strong className="font-semibold tabular-nums">{dollars(waiting)}</strong> waiting to be credited</span>}
      {filtered && <ClearFiltersButton onClick={clear} />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Policy, client or producer" />
      {!decided && (["two", "code", "none"] as CreditWhy[]).map((key) => (
        <ToggleChip key={key} selected={why === key} count={count(key)} onClick={() => { setWhy(why === key ? "" : key); setPage(1); }}>{WHY_CHIP[key]}</ToggleChip>
      ))}
      {carriers.length > 2 && <SelectMenu label="Carrier" className="w-full sm:w-52" searchPlaceholder="Search carriers" value={carrier} defaultValue="" options={carriers} onChange={(v) => { setCarrier(v); setPage(1); }} />}
    </DataToolbar>
  );

  const footer = shownRows.length ? <Pager page={shown.current} total={shownRows.length} noun={decided ? "decisions" : "items"} pageSize={pageSize} onPage={setPage} suffix={decided ? "Newest first · the last 30 days" : "Oldest first; amber after 30 days, red after 90"} /> : undefined;

  return (
    <TableCard toolbar={rows.length ? toolbar : undefined} footer={footer}>
      {rows.length === 0 ? (
        decided
          ? <EmptyState title="Nothing decided in the last 30 days" hint="Each credit you give shows here for 30 days, with who got it and why." />
          : <EmptyState title="Nothing to decide" hint="Every statement line went to one producer. A line two producers could own, or one no producer has, waits here." />
      ) : shownRows.length === 0 ? <NoMatches noun="items" onClear={clear} /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {decided ? <>
                <TableHead>Credited to</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Decided</TableHead>
              </> : <>
                <TableHead>Waiting</TableHead>
                <TableHead>Why</TableHead>
                <TableHead><span className="sr-only">What to do</span></TableHead>
              </>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((r) => {
              const days = ageDays(r.createdAt.slice(0, 10), today);
              const tone = ageTone(days);
              const href = decided ? (r.carrierId && r.policyNumber ? policyPageHref(r.carrierId, r.policyNumber) : null) : itemHref(r.id);
              return (
                <TableRow key={r.id} className={href ? "cursor-pointer" : undefined} onClick={href ? openRow(href) : undefined}>
                  <TableCell className="whitespace-nowrap font-medium">{r.clientName ?? <span className="font-normal text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{policyCell(r)}</TableCell>
                  <TableCell className="text-right">{amountCell(r)}</TableCell>
                  {decided ? <>
                    <TableCell className="whitespace-nowrap"><Person person={r.resolved} /></TableCell>
                    <TableCell className="whitespace-nowrap">{r.reason ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(r.resolvedAt)}</TableCell>
                  </> : <>
                    <TableCell className="whitespace-nowrap tabular-nums">{days} d</TableCell>
                    <TableCell><StatusChip tone={tone ?? "neutral"}>{WHY_CHIP[r.why]}</StatusChip></TableCell>
                    <TableCell className="whitespace-nowrap text-right"><Link href={itemHref(r.id)} className={LINK}>Decide ›</Link></TableCell>
                  </>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
