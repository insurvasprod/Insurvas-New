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
import { ArrowLeft, Check, ExternalLink, History, UserPlus } from "lucide-react";

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

export function ApplicationWorkspace({ initial, sample, timeZone, seatReadOnly = false }: { initial: CaseView; sample: boolean; timeZone?: string; /** A read-only plan (2026-10-26): every control off, like Pending cases. */ seatReadOnly?: boolean }) {
  return (
    <WorkspaceProvider key={initial.caseId} initial={initial} sample={sample} timeZone={timeZone} seatReadOnly={seatReadOnly}>
      <Workspace />
    </WorkspaceProvider>
  );
}
