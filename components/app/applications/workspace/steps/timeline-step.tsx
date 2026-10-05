"use client";

/**
 * Case timeline (LA-3.16; board l3-ws-timeline): every attempt for the insured on screen, oldest
 * first — carrier, premium, how it ended and why — then everything that happened on the case,
 * newest first, read from the records themselves. Plain enough to read to the client: "here's what
 * we've tried". A closed attempt is never edited and never deleted.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { APPLICATION_OUTCOME_LABEL, APPLICATION_STATUS_LABEL, OUTCOME_REASONS, REQUIREMENT_KIND_LABEL, type ApplicationOutcome } from "@/lib/applications/constants";
import type { AttemptView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { AttemptStatusChip, dateTime, face, money } from "@/components/app/applications/parts";
import { coverageOf, dayMonth } from "@/components/app/applications/outcome/model";
import { caseUrl, request } from "@/components/app/applications/submit/api";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";

type TimelineEvent = { id: string; at: string; title: string; by: string | null; detail: string | null; tone: "good" | "warning" | "danger" | "neutral" | "info"; attemptNo: number | null; insuredRole: "primary" | "spouse" | null };

const RETRYABLE: readonly ApplicationOutcome[] = ["declined", "postponed", "declined_by_client", "offer_expired"];
const DOT: Record<TimelineEvent["tone"], string> = { good: "bg-[var(--success)]", warning: "bg-[var(--warning)]", danger: "bg-[var(--error)]", info: "bg-[var(--info)]", neutral: "bg-[var(--muted)]" };
const REQ_STATUS: Record<string, string> = { open: "open", in_progress: "in progress", satisfied: "satisfied", waived: "waived", expired: "expired" };

/** One line per attempt: carrier, premium, outcome and reason (LA-3.16's timeline criterion). */
function summary(a: AttemptView): string {
  const cov = coverageOf(a);
  const cost = cov.monthlyCents ? `${money(cov.monthlyCents)}/mo${cov.faceCents ? ` for ${face(cov.faceCents)}` : ""}` : null;
  if (a.status === "closed" && a.outcome) {
    const reason = OUTCOME_REASONS.find((r) => r.code === a.outcomeReasonCode)?.label ?? null;
    const label = a.outcome === "declined" ? "Declined by carrier" : APPLICATION_OUTCOME_LABEL[a.outcome];
    const why = [reason, a.outcomeReasonText].filter(Boolean).join(" — ");
    return `${label}${why ? ` — ${why}` : ""}.${cost ? ` ${cost}.` : ""}`;
  }
  const offer = a.counteroffers.find((c) => c.status === "pending_client");
  if (a.status === "counteroffer_pending" && offer) return `${face(offer.offered.faceCents)} at ${money(offer.offered.monthlyCents)}/mo offered against ${face(offer.applied.faceCents)} at ${money(offer.applied.monthlyCents)} applied for. Expires ${dayMonth(offer.expiresAt)}.`;
  if (a.status === "draft" && a.attemptNo > 1) return `Carried forward: health, medications, address, beneficiaries, payment.${cost ? ` ${cost}.` : ""}`;
  return `${APPLICATION_STATUS_LABEL[a.status]}${cost ? ` · ${cost}` : ""}.`;
}

export function TimelineStep() {
  const { caseView, attempt: current, attemptsForInsured, insured, sample, actions, timeZone } = useWorkspace();
  const [events, setEvents] = useState<TimelineEvent[] | null>(sample ? [] : null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (sample) return;
    setError(null);
    const r = await request<{ events: TimelineEvent[] }>(caseUrl(caseView.caseId, "/timeline"));
    if (r.ok) setEvents(r.data.events); else setError(r.error);
  }, [caseView.caseId, sample]);
  // Re-read when anything on the case changes (the workspace re-reads the case after each save).
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load, caseView]);

  const carriers = new Set(attemptsForInsured.map((a) => a.carrierId).filter(Boolean)).size;
  const newest = attemptsForInsured[attemptsForInsured.length - 1] ?? null;
  const canRetry = Boolean(newest && newest.status === "closed" && newest.outcome && RETRYABLE.includes(newest.outcome) && caseView.status === "open");
  const onNewest = newest?.id === current.id;
  const retryWhy = !canRetry
    ? newest && newest.status !== "closed" ? `Attempt ${newest.attemptNo} is still live` : caseView.status !== "open" ? "This case is closed" : "Only a declined, postponed, refused or expired attempt opens a new one"
    : !onNewest ? `Open attempt ${newest!.attemptNo} first` : sample ? "Sample data" : undefined;
  const visible = (events ?? []).filter((e) => e.insuredRole === null || e.insuredRole === insured);
  const stepFor = (a: AttemptView) => (a.status === "draft" ? (a.attemptNo > 1 ? "quote" : "interview") : a.status === "ready" ? "submit" : "after");

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <StepCard
        title={insured === "spouse" ? "Attempts · spouse" : "Attempts"}
        chips={<>
          <StatusChip tone="neutral" dot>{carriers} {carriers === 1 ? "carrier" : "carriers"} tried</StatusChip>
          <span title={retryWhy}>
            <Button type="button" variant="outline" onClick={() => void actions.nextAttempt()} disabled={Boolean(retryWhy)}>New attempt</Button>
          </span>
        </>}
        bodyClassName="gap-0 p-0"
      >
        {attemptsForInsured.length === 0 ? (
          <EmptyState title="No attempts yet" hint="An attempt starts when the case opens." />
        ) : (
          <ol aria-label="Attempts, oldest first">
            {attemptsForInsured.map((a, i) => {
              const sub = a.submissions.length ? a.submissions[a.submissions.length - 1] : null;
              const reqs = a.requirements;
              return (
                <li key={a.id} className={cn("flex flex-wrap items-center gap-4 px-[22px] py-4", i > 0 && "border-t border-[var(--border)]", a.id === current.id && "bg-[var(--canvas)]")}>
                  <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold">{a.attemptNo}</span>
                  <div className="min-w-[220px] flex-1">
                    <span className="block text-sm font-semibold text-[var(--ink)]">{a.carrierName ?? "No carrier chosen yet"}</span>
                    <span className="block text-xs text-[var(--muted)]">{summary(a)}</span>
                    {sub?.carrierReference && <span className="block text-xs text-[var(--muted)]">Reference <span className="font-mono">{sub.carrierReference}</span>{sub.policyNumber && sub.policyNumber !== sub.carrierReference ? ` · policy ${sub.policyNumber}` : ""}</span>}
                    {reqs.length > 0 && <span className="block text-xs text-[var(--muted)]">Carrier asked for: {reqs.map((r) => `${REQUIREMENT_KIND_LABEL[r.kind]} (${REQ_STATUS[r.status] ?? r.status})`).join(", ")}</span>}
                  </div>
                  <span className="text-xs text-[var(--muted)] tabular-nums">{sub ? dayMonth(sub.submittedAt) : a.submittedAt ? dayMonth(a.submittedAt) : "—"}</span>
                  <AttemptStatusChip status={a.status} outcome={a.outcome} />
                  <Link
                    href={`?${new URLSearchParams({ insured, attempt: String(a.attemptNo), step: stepFor(a) }).toString()}`}
                    scroll={false}
                    aria-current={a.id === current.id ? "true" : undefined}
                    className="m-arrow inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open attempt ${a.attemptNo}${a.carrierName ? `, ${a.carrierName}` : ""}`}
                  >
                    Open<ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </StepCard>

      <StepCard
        title="Everything that happened"
        chips={events ? <StatusChip tone="neutral" dot={false}>{visible.length} {visible.length === 1 ? "event" : "events"}</StatusChip> : undefined}
      >
        {sample ? (
          <p className="text-sm text-[var(--muted)]">Sample data — the events come from the real case.</p>
        ) : error ? (
          <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        ) : events === null ? (
          <SectionLoading rows={5} columns={2} label="Loading the timeline" />
        ) : visible.length === 0 ? (
          <EmptyState title="Nothing yet" hint="Every step on the case shows up here as it happens." />
        ) : (
          <ol className="flex flex-col gap-3.5" aria-label="Events, newest first">
            {visible.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span aria-hidden="true" className={cn("mt-[7px] size-[7px] shrink-0 rounded-full", DOT[e.tone])} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--ink)]">{e.title}</span>
                  <span className="block text-xs text-[var(--muted)]">{[dateTime(e.at, timeZone), e.by, e.detail].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </StepCard>
    </div>
  );
}

