"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { REVIEW_ERROR_LABELS, REVIEW_ERROR_TYPES, REVIEW_STATUS_LABELS, errorTally, type ReviewErrorType } from "@/lib/agency/reviewCore";
import { sendJson, useAgencyData } from "./use-agency-data";

type Review = {
  id: string; applicationId: string; producerUserId: string; sampleBps: number; sampledAt: string; caseId: string | null;
  status: keyof typeof REVIEW_STATUS_LABELS; errorTypes: ReviewErrorType[]; note: string | null; reviewedAt: string | null; carrierName: string | null;
};
type Item = { code: string; message: string; detail: string | null };
type Verdict = { verdict: "pass" | "pass_with_warnings" | "fail"; blocking: Item[]; warnings: Item[]; passed: string[] };
type Producer = { userId: string; displayName: string };
type Show = "queue" | "reviewed" | "tally";

const STATUS_TONE: Record<Review["status"], StatusTone> = { queued: "action", passed: "good", failed: "danger", fix_requested: "warning" };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

/**
 * AG-1.11 · Application review, a tab of Sales › Applications (moved from Team 2026-11-03; same address) — a sample
 * of each producer's submitted applications, read against LA-3's own check results (never a second set of checks).
 * The list: To review, Reviewed and By producer are chips in the toolbar (the page's tabs are Applications'). A row
 * opens the review's own page (/app/application-review/<id>), where the reviewer passes it, fails it or sends it
 * back to fix, with an error type and a note the producer reads. The tally per producer is what coaching runs on,
 * and where the owner sets each producer's sample rate. A producer sees his own reviews; he never reviews himself.
 */
export function ReviewBoard({ canSetRates, initialShow = "queue" }: { canSetRates: boolean; initialShow?: Show }) {
  const { data, error, loading, refreshing, reload } = useAgencyData<{ reviews: Review[]; canReview: boolean }>("/api/app/agency/review");
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const [show, setShow] = useState<Show>(initialShow);
  const name = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.displayName])), [roster.data]);
  const reviews = useMemo(() => data?.reviews ?? [], [data]);
  const queue = reviews.filter((r) => r.status === "queued");
  const reviewed = useMemo(() => reviews.filter((r) => r.status !== "queued"), [reviews]);
  const tally = useMemo(() => errorTally(reviewed), [reviewed]);
  const rows = show === "queue" ? queue : reviewed;
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(380, 45);
  const shown = paginate(rows, page, pageSize);
  const pick = (next: Show) => {
    setShow(next);
    setPage(1);
    try { const url = new URL(window.location.href); url.searchParams.set("show", next); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`); } catch { /* the list still changes */ }
  };

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => { reload(); roster.reload(); }} refreshing={refreshing} />}>
          <ToggleChip selected={show === "queue"} onClick={() => pick("queue")} count={data ? queue.length : undefined}>To review</ToggleChip>
          <ToggleChip selected={show === "reviewed"} onClick={() => pick("reviewed")} count={data ? reviewed.length : undefined}>Reviewed</ToggleChip>
          <ToggleChip selected={show === "tally"} onClick={() => pick("tally")}>By producer</ToggleChip>
        </DataToolbar>
      }
      footer={data && show !== "tally" && rows.length ? <Pager page={shown.current} total={rows.length} noun="applications" pageSize={pageSize} onPage={setPage} /> : undefined}
    >
      {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={5} label="Loading reviews" /> : show === "tally" ? (
        <TallyTable producers={roster.data?.rows ?? []} reviews={reviews} tally={tally} canSetRates={canSetRates} onSaved={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title={show === "queue" ? "Nothing to review" : "Nothing reviewed yet"} hint={show === "queue" ? "Submitted applications are sampled here at each producer's rate." : "Reviews appear here with their outcome and note."} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Producer</TableHead><TableHead>Carrier</TableHead><TableHead>Sampled</TableHead><TableHead>Status</TableHead><TableHead>Errors</TableHead><TableHead className="text-right"><span className="sr-only">Open</span></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium"><Link className="hover:underline" href={`/app/application-review/${r.id}`}>{name.get(r.producerUserId) ?? "Producer"}</Link></TableCell>
                <TableCell>{r.carrierName ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{day(r.sampledAt)} · {r.sampleBps / 100}%</TableCell>
                <TableCell><StatusChip tone={STATUS_TONE[r.status]}>{REVIEW_STATUS_LABELS[r.status]}</StatusChip></TableCell>
                <TableCell className="text-sm">{r.errorTypes.map((t) => REVIEW_ERROR_LABELS[t]).join(", ") || "—"}</TableCell>
                <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/application-review/${r.id}`}>{r.status === "queued" && data.canReview ? "Review" : "Open"}</Link></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

/**
 * One review, a page of its own (foundation pass 2026-11-03; it was a side panel beside the list). The header: the
 * producer as the title, the status chip, the carrier, the sample date and rate as the facts line; Pass and Send
 * back to fix, with Fail and Open application under More. Below: the checks the submission ran, the error types and
 * the note for the producer. A fail or a fix needs at least one error type and a note; Fail asks once.
 */
export function ReviewRecord({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const { data, error, loading } = useAgencyData<{ reviews: Review[]; canReview: boolean }>("/api/app/agency/review");
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const review = data?.reviews.find((r) => r.id === reviewId) ?? null;
  const producer = roster.data?.rows.find((p) => p.userId === review?.producerUserId)?.displayName ?? "Producer";
  const checks = useAgencyData<{ verdict: Verdict }>(review ? `/api/app/agency/review/${review.id}/checks` : null);
  const [types, setTypes] = useState<ReviewErrorType[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failing, setFailing] = useState(false);
  const crumbs = (title: string) => [{ label: "Sales" }, { label: "Application review", href: "/app/application-review" }, { label: title }];

  if (error) return <><PageHeader title="Application review" breadcrumbs={crumbs("Review")} /><TableCard><ErrorState detail={error} /></TableCard></>;
  if (loading || !data) return <><PageHeader title="Application review" breadcrumbs={crumbs("Review")} /><TableCard><SectionLoading rows={6} columns={2} label="Loading the review" /></TableCard></>;
  if (!review) return <><PageHeader title="Application review" breadcrumbs={crumbs("Not found")} /><TableCard><EmptyState title="That review could not be found" hint="It may belong to a producer you do not see." action={<Button asChild variant="outline"><Link href="/app/application-review">Back to the list</Link></Button>} /></TableCard></>;

  const canReview = data.canReview && review.status === "queued";
  const picked = types ?? review.errorTypes;
  const text = note ?? review.note ?? "";
  const needsDetail = picked.length === 0 || !text.trim();
  const toggle = (t: ReviewErrorType) => setTypes(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]);
  const v = checks.data?.verdict;

  async function record(status: "passed" | "failed" | "fix_requested") {
    setBusy(true);
    const { error: message } = await sendJson("/api/app/agency/review", "POST", { reviewId, status, errorTypes: status === "passed" ? [] : picked, note: text.trim() || null });
    setBusy(false);
    if (message) { notify.fail(message); return; }
    notify.done(status === "passed" ? `Passed. ${producer} sees it in their reviews.` : `${REVIEW_STATUS_LABELS[status]}. ${producer} sees your note.`);
    router.push("/app/application-review");
  }

  const facts = `${review.carrierName ?? "Application"} · sampled ${day(review.sampledAt)} at ${review.sampleBps / 100}%${review.reviewedAt ? ` · reviewed ${day(review.reviewedAt)}` : ""}`;
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader
        title={producer}
        breadcrumbs={crumbs(producer)}
        titleInfo={<StatusChip tone={STATUS_TONE[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</StatusChip>}
        meta={<p className="mt-1 text-sm text-muted-foreground">{facts}</p>}
        actions={<>
          {canReview && <Button variant="outline" disabled={busy || needsDetail} title={needsDetail ? "Pick an error type and write a note first" : undefined} onClick={() => record("fix_requested")}>Send back to fix</Button>}
          {canReview && <Button disabled={busy} onClick={() => record("passed")}>Pass</Button>}
          <MoreMenu items={[
            canReview && { label: "Fail", disabled: busy || needsDetail, onSelect: () => setFailing(true) },
            review.caseId && { label: "Open application", href: `/app/applications/${review.caseId}` },
          ]} />
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TableCard title="Checks at submission">
          {checks.error ? <ErrorState detail={checks.error} /> : !v ? <SectionLoading rows={3} columns={1} label="Loading checks" /> : (
            <Table><TableBody>
              {v.blocking.map((i) => <TableRow key={`b-${i.code}-${i.message}`}><TableCell className="w-28"><StatusChip tone="danger">Blocking</StatusChip></TableCell><TableCell className="whitespace-normal">{i.message}{i.detail && <span className="block text-xs text-[var(--muted)]">{i.detail}</span>}</TableCell></TableRow>)}
              {v.warnings.map((i) => <TableRow key={`w-${i.code}-${i.message}`}><TableCell className="w-28"><StatusChip tone="warning">Warning</StatusChip></TableCell><TableCell className="whitespace-normal">{i.message}{i.detail && <span className="block text-xs text-[var(--muted)]">{i.detail}</span>}</TableCell></TableRow>)}
              <TableRow><TableCell className="w-28"><StatusChip tone="good">Passed · {v.passed.length}</StatusChip></TableCell><TableCell className="whitespace-normal text-[var(--muted)]">{v.passed.join(", ") || "—"}</TableCell></TableRow>
            </TableBody></Table>
          )}
        </TableCard>
        <TableCard title={canReview ? "Your review" : "The review"}>
          <div className="grid gap-4 p-4 text-sm">
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 font-medium">Error types</legend>
              {REVIEW_ERROR_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(t)} disabled={!canReview} onChange={() => toggle(t)} />
                  {REVIEW_ERROR_LABELS[t]}
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1 font-medium">Note for {producer}
              <textarea className="min-h-24 rounded-md border border-input px-2 py-1.5 text-sm font-normal" value={text} disabled={!canReview} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </label>
          </div>
        </TableCard>
      </div>
      <ConfirmDialog open={failing} onOpenChange={setFailing} title={`Fail ${producer}'s application?`} description={`${producer} sees the error types and your note. A failed review counts against their tally.`} confirmLabel="Fail it" busy={busy} onConfirm={() => { setFailing(false); void record("failed"); }} />
    </div>
  );
}

function TallyTable({ producers, reviews, tally, canSetRates, onSaved }: { producers: Producer[]; reviews: Review[]; tally: Map<string, Array<[string, number]>>; canSetRates: boolean; onSaved: () => void }) {
  const [rates, setRates] = useState<Record<string, string>>({});
  const latestRate = (id: string) => reviews.find((r) => r.producerUserId === id)?.sampleBps;
  if (producers.length === 0) return <EmptyState title="No producers yet" hint="Each producer's tally appears once their applications are sampled." />;

  async function save(userId: string) {
    const percent = Number(rates[userId]);
    const { error } = await sendJson("/api/app/agency/review", "PUT", { producerUserId: userId, samplePercent: percent });
    if (error) { notify.fail(error); return; }
    notify.done(`Sample rate set to ${percent}%. It applies to applications submitted from now on.`);
    setRates((r) => { const next = { ...r }; delete next[userId]; return next; });
    onSaved();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Producer</TableHead><TableHead className="text-right">Reviewed</TableHead><TableHead className="text-right">Passed</TableHead><TableHead>Most frequent errors</TableHead><TableHead>Sample rate</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {producers.map((p) => {
          const mine = reviews.filter((r) => r.producerUserId === p.userId && r.status !== "queued");
          const current = latestRate(p.userId);
          return (
            <TableRow key={p.userId}>
              <TableCell className="font-medium">{p.displayName}</TableCell>
              <TableCell className="text-right tabular-nums">{mine.length}</TableCell>
              <TableCell className="text-right tabular-nums">{mine.filter((r) => r.status === "passed").length}</TableCell>
              <TableCell className="text-sm">{(tally.get(p.userId) ?? []).slice(0, 3).map(([t, n]) => `${REVIEW_ERROR_LABELS[t as ReviewErrorType] ?? t} · ${n}`).join("; ") || "—"}</TableCell>
              <TableCell>
                {canSetRates ? (
                  <div className="flex items-center gap-2">
                    <input aria-label={`Sample rate for ${p.displayName}`} type="number" min={0} max={100} className={`${toolbarControl} w-20`} placeholder={current !== undefined ? String(current / 100) : "Default"} value={rates[p.userId] ?? ""} onChange={(e) => setRates((r) => ({ ...r, [p.userId]: e.target.value }))} />
                    <span className="text-sm text-[var(--muted)]">%</span>
                    <Button size="sm" variant="outline" disabled={rates[p.userId] === undefined || rates[p.userId] === ""} onClick={() => save(p.userId)}>Save</Button>
                  </div>
                ) : <span className="tabular-nums">{current !== undefined ? `${current / 100}%` : "Default"}</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
