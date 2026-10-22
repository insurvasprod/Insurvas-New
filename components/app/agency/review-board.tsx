"use client";

import { useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { REVIEW_ERROR_LABELS, REVIEW_ERROR_TYPES, REVIEW_STATUS_LABELS, errorTally, type ReviewErrorType } from "@/lib/agency/reviewCore";
import { sendJson, useAgencyData } from "./use-agency-data";

type Review = {
  id: string; applicationId: string; producerUserId: string; sampleBps: number; sampledAt: string;
  status: keyof typeof REVIEW_STATUS_LABELS; errorTypes: ReviewErrorType[]; note: string | null; reviewedAt: string | null; carrierName: string | null;
};
type Item = { code: string; message: string; detail: string | null };
type Verdict = { verdict: "pass" | "pass_with_warnings" | "fail"; blocking: Item[]; warnings: Item[]; passed: string[] };
type Producer = { userId: string; displayName: string };

const STATUS_TONE: Record<Review["status"], StatusTone> = { queued: "action", passed: "good", failed: "danger", fix_requested: "warning" };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

/**
 * AG-1.11 · Application review — a sample of each producer's submitted applications, read against LA-3's own
 * check results (never a second set of checks). The reviewer passes it, fails it, or sends it back to fix, with an
 * error type and a note the producer reads. The tally per producer is what coaching runs on. A producer sees his
 * own reviews; he never reviews himself.
 */
export function ReviewBoard({ canSetRates }: { canSetRates: boolean }) {
  const { data, error, loading, refreshing, reload } = useAgencyData<{ reviews: Review[]; canReview: boolean }>("/api/app/agency/review");
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const [tab, setTab] = useState<"queue" | "tally" | "reviewed">("queue");
  const [open, setOpen] = useState<Review | null>(null);
  const name = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.displayName])), [roster.data]);
  const reviews = data?.reviews ?? [];
  const queue = reviews.filter((r) => r.status === "queued");
  const reviewed = reviews.filter((r) => r.status !== "queued");
  const tally = useMemo(() => errorTally(reviewed), [reviewed]);
  const rows = tab === "queue" ? queue : reviewed;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Application review" description="A sample of each producer's submitted paperwork, read against the same checks the submission used." />
      <ViewTabs label="Application review" value={tab} onChange={setTab} idPrefix="review-tab" tabs={[
        { key: "queue", label: "To review", count: queue.length },
        { key: "tally", label: "By producer" },
        { key: "reviewed", label: "Reviewed", count: reviewed.length },
      ]} />
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <TableCard className="min-w-0 flex-1" toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />}>
          {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={5} label="Loading reviews" /> : tab === "tally" ? (
            <TallyTable producers={roster.data?.rows ?? []} reviews={reviews} tally={tally} canSetRates={canSetRates} onSaved={reload} />
          ) : rows.length === 0 ? (
            <EmptyState title={tab === "queue" ? "Nothing to review" : "Nothing reviewed yet"} hint={tab === "queue" ? "Submitted applications are sampled here at each producer's rate." : "Reviews appear here with their outcome and note."} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Producer</TableHead><TableHead>Carrier</TableHead><TableHead>Sampled</TableHead><TableHead>Status</TableHead><TableHead>Errors</TableHead><TableHead className="text-right"><span className="sr-only">Open</span></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={open?.id === r.id ? "cursor-pointer bg-[var(--primary-soft)]" : "cursor-pointer"} onClick={() => setOpen(r)}>
                    <TableCell className="font-medium">{name.get(r.producerUserId) ?? "Producer"}</TableCell>
                    <TableCell>{r.carrierName ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{day(r.sampledAt)} · {r.sampleBps / 100}%</TableCell>
                    <TableCell><StatusChip tone={STATUS_TONE[r.status]}>{REVIEW_STATUS_LABELS[r.status]}</StatusChip></TableCell>
                    <TableCell className="text-sm">{r.errorTypes.map((t) => REVIEW_ERROR_LABELS[t]).join(", ") || "—"}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{r.status === "queued" && data.canReview ? "Review" : "Open"}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCard>
        {open && tab !== "tally" && <ReviewPanel key={open.id} review={open} producer={name.get(open.producerUserId) ?? "Producer"} canReview={!!data?.canReview && open.status === "queued"} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
      </div>
    </div>
  );
}

function ReviewPanel({ review, producer, canReview, onClose, onSaved }: { review: Review; producer: string; canReview: boolean; onClose: () => void; onSaved: () => void }) {
  const checks = useAgencyData<{ verdict: Verdict }>(`/api/app/agency/review/${review.id}/checks`);
  const [types, setTypes] = useState<ReviewErrorType[]>(review.errorTypes);
  const [note, setNote] = useState(review.note ?? "");
  const [busy, setBusy] = useState(false);
  const toggle = (t: ReviewErrorType) => setTypes((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]));

  async function record(status: "passed" | "failed" | "fix_requested") {
    setBusy(true);
    const { error } = await sendJson("/api/app/agency/review", "POST", { reviewId: review.id, status, errorTypes: status === "passed" ? [] : types, note: note.trim() || null });
    setBusy(false);
    if (error) { notify.fail(error); return; }
    notify.done(status === "passed" ? `Passed. ${producer} sees it in their reviews.` : `${REVIEW_STATUS_LABELS[status]}. ${producer} sees your note.`);
    onSaved();
  }
  const needsDetail = types.length === 0 || !note.trim();
  const v = checks.data?.verdict;

  return (
    <DetailPanel mode="split" title={producer} subtitle={`${review.carrierName ?? "Application"} · sampled ${day(review.sampledAt)}`} onClose={onClose}
      footer={canReview ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy || needsDetail} onClick={() => record("fix_requested")}>Fix and resubmit</Button>
          <Button variant="outline" disabled={busy || needsDetail} onClick={() => record("failed")}>Fail</Button>
          <Button disabled={busy} onClick={() => record("passed")}>Pass</Button>
        </div>
      ) : undefined}>
      <div className="grid gap-4 text-sm">
        <section>
          <h3 className="mb-2 font-semibold">Checks at submission</h3>
          {checks.error ? <ErrorState detail={checks.error} /> : !v ? <SectionLoading rows={3} columns={1} label="Loading checks" /> : (
            <ul className="grid gap-1.5">
              {v.blocking.map((i) => <li key={`b-${i.code}-${i.message}`} className="flex gap-2"><StatusChip tone="danger">Blocking</StatusChip><span>{i.message}{i.detail && <span className="block text-xs text-[var(--muted)]">{i.detail}</span>}</span></li>)}
              {v.warnings.map((i) => <li key={`w-${i.code}-${i.message}`} className="flex gap-2"><StatusChip tone="warning">Warning</StatusChip><span>{i.message}{i.detail && <span className="block text-xs text-[var(--muted)]">{i.detail}</span>}</span></li>)}
              <li className="text-[var(--muted)]">Passed · {v.passed.length}: {v.passed.join(", ")}</li>
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Error types</h3>
          <div className="grid gap-1.5">
            {REVIEW_ERROR_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2">
                <input type="checkbox" checked={types.includes(t)} disabled={!canReview} onChange={() => toggle(t)} />
                {REVIEW_ERROR_LABELS[t]}
              </label>
            ))}
          </div>
        </section>
        <label className="grid gap-1 font-medium">Note for {producer}
          <textarea className="min-h-20 rounded-md border border-input px-2 py-1.5 text-sm font-normal" value={note} disabled={!canReview} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </label>
        {canReview && needsDetail && <p className="text-xs text-[var(--muted)]">A fail or a fix needs at least one error type and a note.</p>}
      </div>
    </DetailPanel>
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
