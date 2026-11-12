"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { statementFileHref, statementHref, statementName, statementNextStep, statementsViewHref, type StatementsView } from "@/components/app/commissions/statements/list-order";
import { statementDay, statementMoney, statementPeriod, type StatementSummary } from "@/lib/ledger/statementConstants";

const SUFFIX: Record<StatementsView, string> = { review: "oldest first", unmatched: "oldest first", reviewed: "newest first", voided: "newest first" };
const n = (value: number) => value.toLocaleString("en-US");

/**
 * The one chip on a statement's row (owner 2026-11-11: one line per row, colour only in a chip). It replaced the
 * coloured Waiting count and its "N proposed · N no match" sub-line; the split stays in the chip's title and on the
 * statement itself.
 */
function statementState(statement: StatementSummary): { text: string; tone: StatusTone; title?: string } {
  const { proposed, unmatched, errors } = statement.counts;
  const waiting = proposed + unmatched;
  if (statement.status === "voided") return { text: "Voided", tone: "neutral", title: "Voided: these lines no longer post" };
  if (statement.status === "awaiting_entry") return { text: "Lines not typed in", tone: "warning" };
  if (waiting > 0) return { text: `${n(waiting)} waiting`, tone: "warning", title: `${n(proposed)} proposed · ${n(unmatched)} no match${errors ? ` · ${n(errors)} unreadable` : ""}` };
  if (errors > 0) return { text: `${n(errors)} unreadable`, tone: "danger", title: `${n(errors)} could not be read` };
  return { text: "All accepted", tone: "good" };
}

/**
 * Commissions › Statements, one tab of the list (round 7, owner pick 1·A, 2026-11-10; mockups-r7/commissions.html
 * board 1·A). Six columns, one line each (owner 2026-11-11); the whole row opens the statement; the Status chip says
 * what is left and "Next step" is one short verb. The file name opens the carrier's original, and Accepted opens the
 * statement on that tab. The
 * toolbar: search, the carrier, two chips (typed from a PDF, has unreadable lines) and the net still waiting.
 */
export function StatementsTable({ statements, view, waitingCents, initialCarrier = "", emptyTitle, emptyHint, emptyAction, readOnly = false }: {
  /** This tab's statements, in its order. */
  statements: StatementSummary[];
  view: Exclude<StatementsView, "unmatched">;
  /** The net of each statement's waiting lines, in cents. */
  waitingCents: Record<string, number>;
  /** A carrier's id from `?carrier=` (a statement's "{Carrier}'s statements ›"). */
  initialCarrier?: string;
  emptyTitle: string;
  emptyHint: string;
  emptyAction?: ReactNode;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState(initialCarrier);
  const [pdf, setPdf] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Map(statements.map((statement) => [statement.carrierId, statement.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [statements]);
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return statements.filter((statement) =>
      (!needle || `${statement.carrierName} ${statement.fileName} ${statement.uploadedByName ?? ""} ${statementPeriod(statement.periodStart, statement.periodEnd)}`.toLowerCase().includes(needle)) &&
      (!carrier || statement.carrierId === carrier),
    );
  }, [statements, query, carrier]);
  const visible = scoped.filter((statement) => (!pdf || statement.fileKind === "pdf") && (!unreadable || statement.counts.errors > 0));
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || pdf || unreadable);
  const clear = () => { setQuery(""); setCarrier(""); setPdf(false); setUnreadable(false); setPage(1); };
  const netWaiting = visible.reduce((total, statement) => total + (statement.status === "voided" ? 0 : waitingCents[statement.id] ?? 0), 0);
  const waitingLines = visible.reduce((total, statement) => total + (statement.status === "voided" ? 0 : statement.counts.proposed + statement.counts.unmatched), 0);

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-220px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {view !== "voided" && waitingLines > 0 && (
            <Link href={statementsViewHref("unmatched")} className="whitespace-nowrap text-sm text-foreground hover:underline" title="The lines still waiting for a person on these statements">
              <span className="font-semibold tabular-nums">{statementMoney(netWaiting)}</span> net waiting
            </Link>
          )}
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search statements" />
          <select aria-label="Filter statements by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">All carriers</option>
            {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <ToggleChip selected={pdf} onClick={() => { setPdf(!pdf); setPage(1); }} count={n(scoped.filter((statement) => statement.fileKind === "pdf").length)}>Typed from a PDF</ToggleChip>
          <ToggleChip selected={unreadable} onClick={() => { setUnreadable(!unreadable); setPage(1); }} count={n(scoped.filter((statement) => statement.counts.errors > 0).length)} countTone={scoped.some((statement) => statement.counts.errors > 0) ? "danger" : undefined}>Has unreadable lines</ToggleChip>
        </DataToolbar>
      }
      footer={statements.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "statement" : "statements"} suffix={SUFFIX[view]} /> : undefined}
    >
      {statements.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
      ) : visible.length === 0 ? (
        <NoMatches noun="statements" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr>
              <th>Carrier · period</th>
              <th>File</th>
              <th className="w-[120px] text-right">Accepted</th>
              <th className="w-[120px]">Imported</th>
              <th className="w-[170px]">Status</th>
              <th className="w-[110px]">Next step</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((statement) => {
              const open = statementHref(statement.id, view);
              const next = statementNextStep(statement, readOnly);
              const chip = statementState(statement);
              const act = !readOnly && statement.status !== "voided" && chip.tone !== "good";
              // A row is a link to its statement (board 1·A); the links inside it keep their own way.
              return (
                <tr key={statement.id} className="m-row cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) router.push(open); }}>
                  <td className="whitespace-nowrap font-medium text-foreground">
                    <Link href={open} className="hover:underline">{statementName(statement.carrierName, statementPeriod(statement.periodStart, statement.periodEnd))}</Link>
                  </td>
                  <td className="max-w-[280px] truncate" title={statement.fileName}>
                    {statement.hasFile
                      ? <a href={statementFileHref(statement.id)} target="_blank" rel="noopener noreferrer" className="hover:underline" title={`Open ${statement.fileName}, the carrier's file as imported`}>{statement.fileName}</a>
                      : statement.fileName}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    <Link href={statementHref(statement.id, view, { tab: "accepted" })} className="hover:underline" title={statement.status === "voided" ? "Voided: these lines no longer post" : `${n(statement.counts.accepted)} ${statement.counts.accepted === 1 ? "line" : "lines"} posted to the commission ledger`}>{statementMoney(statement.acceptedCents)}</Link>
                  </td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{statementDay(statement.uploadedAt)}</td>
                  <td><StatusChip tone={chip.tone} title={chip.title}>{chip.text}</StatusChip></td>
                  <td>
                    <Link href={next.tab ? statementHref(statement.id, view, { tab: next.tab }) : open} className="whitespace-nowrap hover:underline" title={next.text.replace(/ ›$/, "")}>{act ? "Review ›" : "Open ›"}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
