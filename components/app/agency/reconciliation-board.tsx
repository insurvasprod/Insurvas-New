"use client";

import { useMemo, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { dollars } from "@/lib/agency/constants";
import { ReviewDialog, REVIEW_KIND, type ReviewItem } from "@/components/app/commissions/producer-pay/review-dialog";
import { producerPayHref } from "@/components/app/commissions/producer-pay/period";
import { BasisChip } from "./money";
import type { ProducerPayFigure } from "@/lib/commissions/producerPayFigures";

type Truth = { producerUserId: string; expectedCents: number | null; reportedCents: number; receivedCents: number; expectedMissingLevels: number };
export type PayProducer = { userId: string; producerId: string; name: string; plan: string };
export type ReconciliationView = "pay" | "truths" | "review";

const FIGURE = "tabular-nums underline-offset-2 hover:underline";

/** A figure in a row: plain, one colour; a figure that could not be read is a muted "—". */
function Plain({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{dollars(cents)}</span>;
}

/**
 * AG-1.12 · Commissions › Producer pay, round 7 direction A (owner 2026-11-10, docs/la4/mockups-r7/commissions.html
 * 4·A): the month, then the person. Pay · Three truths · To review are the page's tabs and the month is a select
 * on the title line, both in the address (?view=, ?period=); this draws the view the page names.
 *
 *   Pay           what each producer Earned, was Advanced, was Charged back and was Paid out in the month, and is
 *                 Owed at its end (reported basis, the basis payouts are made on).
 *   Three truths  expected (rate card × level), reported (the carrier statement) and received (the bank), never
 *                 averaged; the two variances named, not netted, amber over the threshold.
 *   To review     the open review items, one row each, opening the Review dialog; reviewed ones stay under the
 *                 "Reviewed" chip with what was found.
 *
 * Rows have no buttons: a Pay or Three truths row opens the producer's Money tab for the month; a To review row
 * opens its dialog. Every figure links to the producer's Money tab for that month.
 */
export function ReconciliationBoard({ view, period, threshold, readOnly, producers, pay, paidOut, truths, reviews }: {
  view: ReconciliationView;
  period: string;
  /** Cents: a difference over this opens a review item. */
  threshold: number;
  readOnly: boolean;
  producers: PayProducer[];
  /** Null where the read failed: the figures show "—", never $0. */
  pay: ProducerPayFigure[] | null;
  paidOut: Record<string, number> | null;
  truths: Truth[] | null;
  reviews: ReviewItem[] | null;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [owes, setOwes] = useState(false);
  const [noLevel, setNoLevel] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<ReviewItem | null>(null);
  const pageSize = useFittingPageSize(420, 45);

  const byUser = useMemo(() => new Map(producers.map((p) => [p.userId, p])), [producers]);
  const payOf = useMemo(() => (pay ? new Map(pay.map((f) => [f.producerUserId, f])) : null), [pay]);
  const truthOf = useMemo(() => new Map((truths ?? []).map((t) => [t.producerUserId, t])), [truths]);
  const openFor = (userId: string) => (reviews ?? []).filter((r) => r.producerUserId === userId && r.status === "open");

  // Everyone with a figure or a truth this month, by name: the order a producer's ‹ › walk.
  const people = useMemo(() => {
    const ids = new Set<string>([...(pay ?? []).map((f) => f.producerUserId), ...(truths ?? []).map((t) => t.producerUserId)]);
    return [...ids].map((id) => byUser.get(id) ?? { userId: id, producerId: "", name: "Producer", plan: "" }).sort((a, b) => a.name.localeCompare(b.name));
  }, [pay, truths, byUser]);
  const owedOf = (userId: string) => payOf?.get(userId)?.owedCents ?? 0;
  const owesCount = people.filter((p) => owedOf(p.userId) < 0).length;
  const noLevelCount = people.filter((p) => (truthOf.get(p.userId)?.expectedMissingLevels ?? 0) > 0).length;
  const needle = query.trim().toLowerCase();
  const rows = people.filter((p) => (!needle || p.name.toLowerCase().includes(needle)) && (!owes || owedOf(p.userId) < 0) && (!noLevel || (truthOf.get(p.userId)?.expectedMissingLevels ?? 0) > 0));
  const owedTotal = people.reduce((sum, p) => sum + Math.max(0, owedOf(p.userId)), 0);
  const owedTo = people.filter((p) => owedOf(p.userId) > 0).length;

  const reviewItems = (reviews ?? [])
    .filter((r) => (showReviewed ? r.status === "reviewed" : r.status === "open"))
    .filter((r) => !needle || (byUser.get(r.producerUserId)?.name ?? "").toLowerCase().includes(needle))
    .sort((a, b) => Math.abs(b.varianceCents) - Math.abs(a.varianceCents));
  const reviewedCount = (reviews ?? []).filter((r) => r.status === "reviewed").length;

  const filtered = Boolean(needle || owes || noLevel || showReviewed);
  const clear = () => { setQuery(""); setOwes(false); setNoLevel(false); setShowReviewed(false); setPage(1); };
  const thresholdWords = `Differences over ${dollars(threshold)} open a review`;
  const recordOf = (userId: string) => {
    const p = byUser.get(userId);
    return p?.producerId ? producerPayHref(p.producerId, period) : null;
  };
  // The whole row opens; its own links keep their click.
  const openRow = (href: string | null) => (event: MouseEvent<HTMLElement>) => {
    if (!href || (event.target as HTMLElement).closest("a, button")) return;
    router.push(href);
  };
  const figureLink = (userId: string, cents: number | null | undefined, chip?: string) => {
    const record = byUser.get(userId);
    if (cents === null || cents === undefined) return <Plain cents={cents} />;
    return record?.producerId ? <Link href={producerPayHref(record.producerId, period, chip ? { chip } : undefined)} className={FIGURE}>{dollars(cents)}</Link> : <Plain cents={cents} />;
  };
  /**
   * The row's one chip, the state it is in, worst first: owes the agency, then the differences to review (or a
   * difference over the threshold), then policies with no level, else within the threshold.
   */
  const statusChip = (userId: string, owedCents: number | null, gaps: Array<[string, number | null]>) => {
    if (owedCents !== null && owedCents < 0) return <StatusChip tone="danger">Owes the agency</StatusChip>;
    const items = openFor(userId);
    if (items.length > 1) return <StatusChip tone="warning">{items.length} differences to review</StatusChip>;
    if (items.length === 1) return <StatusChip tone="warning">{dollars(Math.abs(items[0].varianceCents))} {REVIEW_KIND[items[0].kind].toLowerCase()}</StatusChip>;
    const gap = gaps.find(([, cents]) => cents !== null && Math.abs(cents) > threshold);
    if (gap) return <StatusChip tone="warning">{dollars(Math.abs(gap[1] as number))} {gap[0]}</StatusChip>;
    const missing = truthOf.get(userId)?.expectedMissingLevels ?? 0;
    if (missing > 0) return <StatusChip tone="warning">{missing} {missing === 1 ? "policy" : "policies"} with no level</StatusChip>;
    if (!reviews) return <span className="text-muted-foreground">—</span>;
    return <StatusChip tone="good">Within {dollars(threshold)}</StatusChip>;
  };

  const toolbar = (
    <DataToolbar actions={<>
      {view === "pay" && pay && <span className="text-sm text-foreground">Reported basis · <strong className="font-semibold tabular-nums">{dollars(owedTotal)}</strong> owed to {owedTo} {owedTo === 1 ? "producer" : "producers"}</span>}
      {view === "truths" && <span className="text-sm text-muted-foreground">{thresholdWords}</span>}
      {filtered && <ClearFiltersButton onClick={clear} />}
      <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
    </>}>
      <ToolbarSearch value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Producer" label="Search producers" />
      {view === "review" ? (
        <ToggleChip selected={showReviewed} count={reviewedCount} onClick={() => { setShowReviewed(!showReviewed); setPage(1); }}>Reviewed</ToggleChip>
      ) : <>
        <ToggleChip selected={owes} count={owesCount} countTone={owesCount ? "danger" : undefined} onClick={() => { setOwes(!owes); setPage(1); }}>Owes the agency</ToggleChip>
        <ToggleChip selected={noLevel} count={noLevelCount} countTone={noLevelCount ? "warning" : undefined} onClick={() => { setNoLevel(!noLevel); setPage(1); }}>No level on a policy</ToggleChip>
      </>}
    </DataToolbar>
  );

  if (view === "review") {
    const shown = paginate(reviewItems, page, pageSize);
    const reviewingName = reviewing ? byUser.get(reviewing.producerUserId)?.name ?? "the producer" : "";
    const truth = reviewing ? truthOf.get(reviewing.producerUserId) : undefined;
    const reviewFacts: Array<[string, ReactNode]> = truth ? [
      ["Expected", <span key="e">{truth.expectedCents === null ? "—" : dollars(truth.expectedCents)} <span className="text-muted-foreground">from the rate card</span></span>],
      ["Reported", <span key="r">{dollars(truth.reportedCents)} <span className="text-muted-foreground">on the statements</span></span>],
      ["Received", <span key="b">{dollars(truth.receivedCents)} <span className="text-muted-foreground">in the bank</span></span>],
    ] : [];
    return (
      <>
        <TableCard toolbar={toolbar} footer={reviewItems.length ? <Pager page={shown.current} total={reviewItems.length} noun="review items" pageSize={pageSize} onPage={setPage} /> : undefined}>
          {!reviews ? <ErrorState detail="The reviews could not be read. Refresh to try again." /> : reviewItems.length === 0 ? (
            filtered && !(showReviewed && !needle) ? <NoMatches noun="review items" onClear={clear} />
              : <EmptyState title={showReviewed ? "Nothing reviewed this month" : "Nothing needs a review"} hint={`${thresholdWords} here. Reviewed items stay under "Reviewed".`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producer</TableHead>
                  <TableHead>Difference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>{showReviewed ? "What you found" : "Status"}</TableHead>
                  <TableHead><span className="sr-only">What to do</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.rows.map((r) => {
                  const record = recordOf(r.producerUserId);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={(event) => { if (!(event.target as HTMLElement).closest("a")) setReviewing(r); }}>
                      <TableCell className="whitespace-nowrap font-medium">{record ? <Link href={record} className="hover:underline">{byUser.get(r.producerUserId)?.name ?? "Producer"}</Link> : byUser.get(r.producerUserId)?.name ?? "Producer"}</TableCell>
                      <TableCell className="whitespace-nowrap">{REVIEW_KIND[r.kind]}</TableCell>
                      <TableCell className="text-right">{figureLink(r.producerUserId, r.varianceCents)}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.status === "reviewed" ? (r.note ?? "Reviewed") : <StatusChip tone="warning">Open</StatusChip>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{r.status === "reviewed" ? "Open ›" : "Review ›"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TableCard>
        <ReviewDialog review={reviewing} name={reviewingName} facts={reviewFacts} readOnly={readOnly} onClose={() => setReviewing(null)} />
      </>
    );
  }

  const shown = paginate(rows, page, pageSize);
  const footerNote = view === "pay" ? "From the carrier statements: the basis payouts are made on" : thresholdWords;
  return (
    <TableCard toolbar={people.length ? toolbar : undefined} footer={rows.length ? <Pager page={shown.current} total={rows.length} noun="producers" pageSize={pageSize} onPage={setPage} suffix={footerNote} /> : undefined}>
      {(view === "pay" ? !pay : !truths) ? <ErrorState detail="These figures could not be read. Refresh to try again." /> : people.length === 0 ? (
        <EmptyState title="No producers yet" hint="Each producer's three numbers appear once statements are posted." action={<Button asChild variant="outline"><Link href="/app/statements">Open Statements</Link></Button>} />
      ) : rows.length === 0 ? <NoMatches noun="producers" onClear={clear} /> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producer</TableHead>
              {view === "pay" ? <>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Charged back</TableHead>
                <TableHead className="text-right">Paid out</TableHead>
                <TableHead className="text-right">Owed at month end</TableHead>
              </> : <>
                <TableHead className="text-right">Expected <BasisChip basis="expected" /></TableHead>
                <TableHead className="text-right">Reported <BasisChip basis="reported" /></TableHead>
                <TableHead className="text-right">Received <BasisChip basis="received" /></TableHead>
              </>}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((p) => {
              const record = recordOf(p.userId);
              const truth = truthOf.get(p.userId);
              // No ledger line in the month is $0 earned; a read that failed is "—".
              const figure = payOf ? payOf.get(p.userId) ?? { earnedCents: 0, advancedCents: 0, chargedBackCents: 0, owedCents: 0 } : null;
              const paid = paidOut ? paidOut[p.userId] ?? 0 : null;
              const expToRep = truth && truth.expectedCents !== null ? truth.reportedCents - truth.expectedCents : null;
              const repToRec = truth ? truth.receivedCents - truth.reportedCents : null;
              return (
                <TableRow key={p.userId} className={record ? "cursor-pointer" : undefined} onClick={openRow(record)}>
                  <TableCell className="whitespace-nowrap font-medium">{record ? <Link href={record} className="hover:underline">{p.name}</Link> : p.name}</TableCell>
                  {view === "pay" ? <>
                    <TableCell className="text-right">{figureLink(p.userId, figure?.earnedCents, "ledger")}</TableCell>
                    <TableCell className="text-right">{figureLink(p.userId, figure?.chargedBackCents, "chargebacks")}</TableCell>
                    <TableCell className="text-right">{figureLink(p.userId, paid, "statements")}</TableCell>
                    <TableCell className="text-right">{figureLink(p.userId, figure?.owedCents, "ledger")}</TableCell>
                  </> : <>
                    <TableCell className="text-right">{truth ? figureLink(p.userId, truth.expectedCents) : <Plain cents={null} />}</TableCell>
                    <TableCell className="text-right">{truth ? figureLink(p.userId, truth.reportedCents, "ledger") : <Plain cents={null} />}</TableCell>
                    <TableCell className="text-right">{truth ? figureLink(p.userId, truth.receivedCents, "statements") : <Plain cents={null} />}</TableCell>
                  </>}
                  <TableCell>{statusChip(p.userId, view === "pay" ? figure?.owedCents ?? null : null, view === "pay" ? [] : [["expected vs reported", expToRep], ["reported vs received", repToRec]])}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
