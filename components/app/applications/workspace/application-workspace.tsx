"use client";

/**
 * /app/applications/[caseId] — the application workspace (LA-3; boards l3-ws-*). One case, its
 * attempts, one step at a time. Redesign 2026-10-28 (owner pick C, canvas M3 · Application (every
 * step)): one navigator with the four stages and their ten steps; the client card on the left of every
 * step (what we know, and what this step still needs); the step on the right under a line saying what
 * it is for, with its next action at its foot. The full pre-submission verdict lives on Review.
 * Inbound, outbound and lead-detail all open this same page (build it once).
 */

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ExternalLink, History, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { backLink } from "@/lib/applications/backLink";
import { WORKSPACE_STEPS, PRODUCT_LABEL, type WorkspaceStep } from "@/lib/applications/constants";
import type { AttemptView, CaseView } from "@/lib/applications/types";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { AttemptStatusChip, face, SampleDataNotice } from "@/components/app/applications/parts";
import { AddSpouseDialog } from "@/components/app/applications/household/add-spouse-dialog";
import { HouseholdHeader } from "@/components/app/applications/household/household-header";
import { useWorkspace, WorkspaceProvider, type WorkspaceState } from "./context";
import { ClientCard } from "./client-card";
import { VerifyStep, verifyConfirmed, verifyItems } from "@/components/app/applications/workspace/steps/verify-step";
import { InterviewStep } from "@/components/app/applications/workspace/steps/interview-step";
import { QuoteStep } from "@/components/app/applications/workspace/steps/quote-step";
import { ApplicationStep } from "@/components/app/applications/workspace/steps/application-step";
import { BeneficiariesStep } from "@/components/app/applications/workspace/steps/beneficiaries-step";
import { PaymentStep } from "@/components/app/applications/workspace/steps/payment-step";
import { DisclosuresStep } from "@/components/app/applications/workspace/steps/disclosures-step";
import { ReviewStep } from "@/components/app/applications/workspace/steps/review-step";
import { SubmitStep } from "@/components/app/applications/workspace/steps/submit-step";
import { AfterStep } from "@/components/app/applications/workspace/steps/after-step";
import { TimelineStep } from "@/components/app/applications/workspace/steps/timeline-step";

const STEP_COMPONENT: Record<WorkspaceStep, () => React.ReactNode> = {
  verify: VerifyStep,
  interview: InterviewStep,
  quote: QuoteStep,
  application: ApplicationStep,
  beneficiaries: BeneficiariesStep,
  payment: PaymentStep,
  disclosures: DisclosuresStep,
  review: ReviewStep,
  submit: SubmitStep,
  after: AfterStep,
  timeline: TimelineStep,
};

const NUMBERED = WORKSPACE_STEPS.filter((s) => s.key !== "timeline");
const READ_ONLY_TITLE = "Read-only — nothing on this attempt can change";

/** "Pat Household" from the attempt's own insured name fields; "" when neither is set. */
function insuredName(a: AttemptView | undefined) {
  const text = (key: string) => { const v = a?.values[key]?.value; return typeof v === "string" ? v.trim() : ""; };
  return [text("insured.first_name"), text("insured.last_name")].filter(Boolean).join(" ");
}

/** Whether a step is finished, for the rail's green tick. Derived from the attempt, never stored. */
export function stepDone(key: WorkspaceStep, ws: Pick<WorkspaceState, "attempt" | "interview" | "qa" | "caseView">): boolean {
  const { attempt, interview, qa, caseView } = ws;
  const blocking = (step: WorkspaceStep) => qa.blocking.some((i) => i.step === step);
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  switch (key) {
    case "verify": return Boolean(caseView.verification?.complete) || submitted || verifyItems(attempt, caseView).every((item) => verifyConfirmed(item, attempt, caseView));
    case "interview": return Boolean(interview?.completedAt);
    case "quote": return Boolean(attempt.selectedQuoteId) && !blocking("quote");
    case "application": return Boolean(attempt.selectedQuoteId) && !blocking("application");
    case "beneficiaries": return attempt.beneficiaries.length > 0 && !blocking("beneficiaries");
    case "payment": return Boolean(attempt.payment) && !blocking("payment");
    case "disclosures": return !attempt.disclosures.some((d) => d.status === "required");
    case "review": return attempt.status !== "draft";
    case "submit": return submitted;
    case "after": return attempt.status === "closed";
    default: return false;
  }
}

/** The ten steps in four stages (2026-10-26). The step keys, URLs and order are unchanged. */
const STAGES: ReadonlyArray<{ key: string; label: string; steps: WorkspaceStep[] }> = [
  { key: "qualify", label: "Qualify", steps: ["verify", "interview", "quote"] },
  { key: "apply", label: "Apply", steps: ["application", "beneficiaries", "payment", "disclosures"] },
  { key: "submit", label: "Submit", steps: ["review", "submit"] },
  { key: "after", label: "After", steps: ["after"] },
];
const STEP_LABEL = new Map(WORKSPACE_STEPS.map((s) => [s.key, s.label]));
const STEP_NUMBER = new Map<string, number>(NUMBERED.map((s, i) => [s.key, i + 1]));

/**
 * The one navigator (owner pick C, 2026-10-28; a filling bar, owner 2026-10-28): the ten steps spread
 * across the full width on one line, the four stages named above their steps. The line between the dots
 * fills as the steps are finished, up to the first one that is not. Every step is a click away; After
 * opens once submitted.
 */
function StepNav() {
  const ws = useWorkspace();
  const { step, goTo, attempt } = ws;
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  const keys = NUMBERED.map((s) => s.key);
  const done = keys.map((key) => stepDone(key, ws));
  // How far the line runs: to the first step not finished (the whole way once all are).
  const firstOpen = done.indexOf(false);
  const reach = firstOpen === -1 ? keys.length - 1 : firstOpen;
  const fill = `${(reach / (keys.length - 1)) * 100}%`;
  return (
    <nav aria-label="Application steps" className="m-glass rounded-xl border border-border px-4 pt-3 pb-3.5">
      <div className="grid grid-cols-10 gap-0">
        {STAGES.map((stage, i) => (
          <span key={stage.key} style={{ gridColumn: `span ${stage.steps.length}` }} className={cn("px-2 pb-2 text-xs font-semibold tracking-[0.06em] text-[var(--muted)] uppercase", i > 0 && "border-l border-[var(--border)]")}>
            {stage.label}
          </span>
        ))}
      </div>
      <div className="relative">
        {/* The track runs from the first dot's centre to the last one's; the fill grows along it. */}
        <span aria-hidden="true" className="absolute top-[10px] right-[5%] left-[5%] md:top-[13px] h-1 rounded-full bg-[var(--surface-alt)]">
          <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none" style={{ width: fill }} />
        </span>
        <ol className="relative m-0 grid list-none grid-cols-10 p-0">
          {keys.map((key, i) => {
            const here = step === key;
            const locked = key === "after" && !submitted;
            return (
              <li key={key} className="flex justify-center">
                <button
                  type="button"
                  aria-current={here ? "step" : undefined}
                  disabled={locked}
                  title={locked ? "Opens once the application is submitted" : STEP_LABEL.get(key)}
                  onClick={() => goTo(key)}
                  className="group flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span aria-hidden="true" className={cn(
                    "inline-grid size-6 place-items-center rounded-full border-2 md:size-[30px] text-xs font-bold transition-colors",
                    here ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--ink)] shadow-[0_0_0_4px_var(--primary-soft)] motion-safe:animate-[m-pulse_1.2s_ease-out_1]"
                      : done[i] ? "border-[var(--primary)] bg-[var(--surface)] text-[var(--accent-ink)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] group-hover:border-[var(--border-strong)]",
                  )}>
                    {done[i] && !here ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn("max-w-full truncate text-xs sm:text-sm", here ? "font-semibold text-[var(--ink)]" : done[i] ? "text-[var(--body)]" : "text-[var(--muted)]", "max-md:sr-only")}>
                    {STEP_LABEL.get(key) ?? key}
                  </span>
                  {done[i] && <span className="sr-only"> (done)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {/* On a phone the names do not fit under the dots: the step on screen is named once, here. */}
      {STEP_NUMBER.get(step) && <p className="m-0 mt-2 text-center text-sm font-semibold text-[var(--ink)] md:hidden">Step {STEP_NUMBER.get(step)} of {keys.length} · {STEP_LABEL.get(step)}</p>}
    </nav>
  );
}

/**
 * Inbound's Underwriting step (owner 2026-10-28): the client's name, and under it the ten steps on a
 * vertical line in their four stages — the same dots, ticks and filling line as the bar, stood up. The
 * agent works from step 1: a step opens once every step before it is done (or it was reached before).
 * Finish the call is always at the foot.
 */
function InboundRail({ name, onFinish }: { name: string; onFinish: () => void }) {
  const ws = useWorkspace();
  const { step, goTo } = ws;
  const keys = NUMBERED.map((s) => s.key);
  const done = keys.map((key) => stepDone(key, ws));
  const firstOpen = done.indexOf(false);
  const reach = firstOpen === -1 ? keys.length - 1 : firstOpen;
  const here = keys.indexOf(step as (typeof keys)[number]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const doneCount = done.filter(Boolean).length;
  // Owner 2026-10-28: the rail stands the column's full height — every row shares the space — and the
  // line runs unbroken from step 1 to After submit, filling green as each step is finished. Steps not
  // reachable yet are dimmed (their title says why) rather than each wearing a lock.
  const seg = (green: boolean, hidden = false) => (
    <span aria-hidden="true" className={cn("w-[3px] flex-1 rounded-full transition-colors duration-700", hidden ? "opacity-0" : green ? "bg-[var(--primary)] shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_45%,transparent)]" : "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]")} />
  );
  return (
    <aside aria-label="The client and the application steps" className="m-glass flex min-h-0 flex-col gap-4 rounded-xl border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] p-4 lg:h-full">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--primary-soft)] text-sm font-bold text-[var(--accent-ink)]">{initials || "?"}</span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-base font-semibold text-[var(--ink)]">{name}</strong>
          <span className="text-xs text-[var(--body)]">{doneCount} of {keys.length} steps done</span>
        </span>
      </div>
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]">
        <span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ width: `${(doneCount / keys.length) * 100}%` }} />
      </span>

      {/* Room on every side so the step on screen — its pill and its glow — is never cut by the scroll box. */}
      <nav aria-label="Application steps" className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1.5">

        {/* Owner 2026-10-28 (round 3, /ui-taste): no stage names — ten steps, one line, one state each. */}
        <ol className="m-0 flex min-h-full list-none flex-col p-0">
          {keys.map((key, i) => {
                  const on = step === key;
                  const open = i <= Math.max(reach, here) || done[i];
                  return (
                    <li key={key} className="flex min-h-[40px] flex-1">
                      <button
                        type="button"
                        aria-current={on ? "step" : undefined}
                        disabled={!open}
                        title={open ? STEP_LABEL.get(key) : "Finish the steps before it first"}
                        onClick={() => goTo(key)}
                        className="group relative flex w-full items-stretch gap-3 text-left outline-none disabled:cursor-not-allowed"
                      >
                        {/* The step on screen is one pill, dot and name together (owner 2026-10-28: not split in two). */}
                        {on && <span aria-hidden="true" className="absolute top-1/2 -left-[5px] right-0 h-[2.5rem] -translate-y-1/2 rounded-full bg-[var(--primary-soft)] ring-1 ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]" />}
                        <span className="relative flex w-[30px] shrink-0 flex-col items-center">
                          {seg(i > 0 && done[i - 1], false)}
                          <span aria-hidden="true" className={cn(
                            "my-0.5 inline-grid size-[30px] shrink-0 place-items-center rounded-full border-2 text-xs font-bold transition-all duration-300",
                            on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)] shadow-[0_0_14px_color-mix(in_srgb,var(--primary)_55%,transparent)]"
                              : done[i] ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]"
                              : open ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] group-hover:border-[var(--primary)]"
                              : "border-[color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[var(--surface)] text-[var(--body)] opacity-70",
                          )}>
                            {done[i] && !on ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                          </span>
                          {seg(done[i], i === keys.length - 1)}
                        </span>
                        <span className={cn(
                          "relative my-auto flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full py-1.5 pr-1.5 pl-1 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                          !on && open && "group-hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]",
                        )}>
                          <span className={cn("truncate text-sm", on ? "font-semibold text-[var(--ink)]" : open ? "font-medium text-[var(--ink)]" : "font-medium text-[var(--body)] opacity-60")}>{STEP_LABEL.get(key) ?? key}</span>
                          {on ? <span className="shrink-0 rounded-full bg-[var(--primary)] px-2 py-0.5 text-xs font-bold text-[var(--on-primary)]">Now</span>
                            : done[i] ? <span className="sr-only"> (done)</span> : null}
                        </span>
                      </button>
                    </li>
                  );
          })}
        </ol>
      </nav>
      <Button type="button" className="shrink-0" onClick={onFinish}>Finish the call<ArrowRight aria-hidden="true" /></Button>
    </aside>
  );
}

function InboundWorkspace({ onFinish }: { onFinish: () => void }) {
  const ws = useWorkspace();
  const { caseView, step, sample, seatReadOnly } = ws;
  const Step = STEP_COMPONENT[step];
  // Owner 2026-10-28: inside the call there is no title, attempt picker, portal, timeline or spouse
  // button, and no status or product tags — the call page's own bar and this rail are the whole frame.
  return (
    // The call page gives this the screen's height: the rail stands it in full, the step scrolls inside.
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      {sample && <SampleDataNotice />}
      {seatReadOnly && <p role="status" className="m-0 rounded-lg border border-border bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--body)]">Your plan is read-only: you can read this case, not change it.</p>}
      <div className="grid min-w-0 items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-stretch">
        <InboundRail name={caseView.clientName} onFinish={onFinish} />
        <div role="region" aria-label={STEP_LABEL.get(step)} className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <div key={step} className="flex min-w-0 flex-col gap-4 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both]">
            <Step />
          </div>
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const ws = useWorkspace();
  const { caseView, attempt, attemptsForInsured, insured, step, readOnly, seatReadOnly, sample, selectAttempt } = ws;
  const [spouseOpen, setSpouseOpen] = useState(false);
  // Back to where the agent came from (the verification panel, a lead, the dialer…), not always the list.
  const back = backLink(useSearchParams().get("from"));
  const household = caseView.attempts.some((a) => a.insuredRole === "spouse");
  const Step = STEP_COMPONENT[step];
  const selected = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  const productChip = [attempt.productCode ? PRODUCT_LABEL[attempt.productCode] ?? attempt.productLabel : attempt.productLabel, selected ? face(selected.faceAmountCents) : null].filter(Boolean).join(" · ");
  const liveInsureds = new Set(caseView.attempts.map((a) => a.insuredRole)).size;
  // The spouse's own name, from the attempt on screen or any other spouse attempt that has one.
  const spouseName = insured === "spouse" ? insuredName(attempt) : "";
  const spouseOption = household ? insuredName(caseView.attempts.find((a) => a.insuredRole === "spouse" && insuredName(a))) : "";

  function openPortal() {
    if (!attempt.carrierPortalUrl) return;
    window.open(attempt.carrierPortalUrl, "_blank", "noopener,noreferrer");
    if (attempt.portalUsername) {
      void navigator.clipboard?.writeText(attempt.portalUsername).then(
        () => notify.done(`Username ${attempt.portalUsername} copied`, { detail: "Your password manager fills the rest." }),
        () => notify.warn("The portal opened, but the username could not be copied"),
      );
    }
  }

  return (
    <div className="m-stagger flex flex-col gap-6">
      <Link href={back.href} className="-mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />{back.label}
      </Link>
      <PageHeader
        title={insured === "spouse" ? ((spouseName || spouseOption) ? `${spouseName || spouseOption} · spouse` : `${caseView.clientName}'s spouse`) : caseView.clientName}
        actions={<>
          {/* Which application is on screen, then what to do with it: one group, top right (2026-10-06 redesign). */}
          {household && (
            <select aria-label="Insured" className={toolbarControl} value={insured} onChange={(e) => selectAttempt(0, e.target.value as "primary" | "spouse")}>
              <option value="primary">{caseView.clientName}</option>
              <option value="spouse">{spouseOption ? `${spouseOption} (spouse)` : "Spouse"}</option>
            </select>
          )}
          {attemptsForInsured.length > 0 && (
            <select aria-label="Attempt" className={toolbarControl} value={attempt.attemptNo} onChange={(e) => selectAttempt(Number(e.target.value))}>
              {attemptsForInsured.map((a) => <option key={a.id} value={a.attemptNo}>Attempt {a.attemptNo} · {a.carrierName ?? "no carrier yet"}</option>)}
            </select>
          )}
          <Button type="button" variant="outline" onClick={openPortal} disabled={!attempt.carrierPortalUrl} title={attempt.carrierPortalUrl ? undefined : "Choose a carrier with a portal address first"}>
            <ExternalLink aria-hidden="true" />Open portal
          </Button>
          <Button type="button" variant="outline" aria-pressed={step === "timeline"} onClick={() => ws.goTo("timeline")}>
            <History aria-hidden="true" />Case timeline
          </Button>
          {!household && (
            <Button type="button" variant="outline" onClick={() => setSpouseOpen(true)} disabled={readOnly} title={readOnly ? READ_ONLY_TITLE : undefined}>
              <UserPlus aria-hidden="true" />Add spouse
            </Button>
          )}
        </>}
      />
      {/* The case's key facts in one line under the title. */}
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <AttemptStatusChip status={attempt.status} outcome={attempt.outcome} />
        {productChip && <StatusChip tone="neutral" dot>{productChip}</StatusChip>}
        {attempt.carrierName && <StatusChip tone="neutral" dot={false}>{attempt.carrierName}</StatusChip>}
        {household && <StatusChip tone="info">Household · {liveInsureds} applications</StatusChip>}
      </div>
      {sample && <SampleDataNotice />}
      {seatReadOnly && <p role="status" className="m-0 rounded-lg border border-border bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--body)]">Your plan is read-only: you can read this case, not change it.</p>}
      {/* Both sides and the combined premium, on every step of a household case (LA-3.24). */}
      {household && <HouseholdHeader caseView={caseView} insured={insured} />}

      <StepNav />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
        <ClientCard name={insured === "spouse" ? (spouseName || spouseOption || `${caseView.clientName}'s spouse`) : caseView.clientName} />
        <div role="region" aria-label={STEP_LABEL.get(step)} className="flex min-w-0 flex-col gap-4">
          {/* No "Step n of 10" heading on any step (owner, 2026-10-28): the bar above says where the agent is.
              A new step rises in, so moving on reads as moving on. */}
          <div key={step} className="flex min-w-0 flex-col gap-4 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both]">
            <Step />
          </div>
        </div>
      </div>
      <AddSpouseDialog open={spouseOpen} onOpenChange={setSpouseOpen} />
    </div>
  );
}

export function ApplicationWorkspace({ initial, sample, timeZone, seatReadOnly = false, onFinishCall }: {
  initial: CaseView; sample: boolean; timeZone?: string;
  /** A read-only plan (2026-10-26): every control off, like Pending cases. */ seatReadOnly?: boolean;
  /** Inbound's Underwriting step (owner 2026-10-28): the workspace inside the call, starting at Verify. */ onFinishCall?: () => void;
}) {
  return (
    <WorkspaceProvider key={initial.caseId} initial={initial} sample={sample} timeZone={timeZone} seatReadOnly={seatReadOnly} defaultStep={onFinishCall ? "verify" : undefined}>
      {onFinishCall ? <InboundWorkspace onFinish={onFinishCall} /> : <Workspace />}
    </WorkspaceProvider>
  );
}
