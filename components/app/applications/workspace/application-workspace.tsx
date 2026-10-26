"use client";

/**
 * /app/applications/[caseId] — the application workspace (LA-3; boards l3-ws-*). One case, its
 * attempts, one step at a time. Redesign 2026-10-26 (owner pick A, canvas M3 · Case): the ten steps
 * grouped into four stages — Qualify, Apply, Submit, After — as a bar across the top, the stage's steps
 * as tabs under it, the step's card in the middle and the live pre-submission check on the right of
 * every step. Inbound, outbound and lead-detail all open this same page (build it once).
 */

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, UserPlus } from "lucide-react";

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
import { QaRail } from "./qa-rail";
import { VerifyStep } from "@/components/app/applications/workspace/steps/verify-step";
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
    case "verify": return Boolean(caseView.verification?.complete) || submitted;
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

/** The four stages across the top: done, here, or still to come. A stage opens on its first unfinished step. */
function StageBar() {
  const ws = useWorkspace();
  const { step, goTo, attempt } = ws;
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  return (
    <nav aria-label="Application stages" className="m-glass flex flex-wrap items-stretch gap-2.5 rounded-xl border border-border px-4 py-3">
      {STAGES.map((stage) => {
        const here = (stage.steps as readonly string[]).includes(step);
        const done = stage.steps.every((key) => stepDone(key, ws));
        const locked = stage.key === "after" && !submitted;
        const target = stage.steps.find((key) => !stepDone(key, ws)) ?? stage.steps[0];
        return (
          <button
            key={stage.key}
            type="button"
            aria-current={here ? "step" : undefined}
            disabled={locked}
            title={locked ? "Opens once the application is submitted" : undefined}
            onClick={() => goTo(target)}
            style={{ flexGrow: stage.steps.length }}
            className="flex min-w-[120px] basis-0 flex-col gap-1.5 rounded-lg px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden className={cn("h-1.5 rounded-full", done ? "bg-[var(--primary)]" : here ? "bg-[var(--primary)]/45" : "bg-[var(--surface-alt)]")} />
            <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", done ? "text-[var(--accent-ink)]" : here ? "text-[var(--ink)]" : "text-[var(--muted)]")}>
              {done && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}{stage.label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        aria-current={step === "timeline" ? "step" : undefined}
        onClick={() => goTo("timeline")}
        className={cn("self-center border-l border-border pl-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", step === "timeline" ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--body)] hover:text-[var(--ink)]")}
      >
        Case timeline
      </button>
    </nav>
  );
}

/** The current stage's steps as tabs, each with its tick or its number. */
function StepTabs() {
  const ws = useWorkspace();
  const { step, goTo } = ws;
  const stage = STAGES.find((s) => (s.steps as readonly string[]).includes(step));
  if (!stage || stage.steps.length < 2) return null;
  return (
    <div role="tablist" aria-label={`${stage.label} steps`} className="flex flex-wrap gap-5 border-b border-border">
      {stage.steps.map((key) => {
        const active = step === key;
        const done = !active && stepDone(key, ws);
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => goTo(key)}
            className={cn("-mb-px inline-flex h-9 items-center gap-2 border-b-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-[var(--primary)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]")}
          >
            <span aria-hidden className={cn("inline-flex size-[18px] items-center justify-center rounded-full text-xs", done ? "bg-[var(--success)] text-white" : active ? "bg-[var(--primary)] text-[var(--ink)]" : "bg-[var(--surface-alt)] text-[var(--muted)]")}>
              {done ? <Check className="size-3" strokeWidth={3} /> : STEP_NUMBER.get(key)}
            </span>
            {STEP_LABEL.get(key)}
            {done && <span className="sr-only"> (done)</span>}
          </button>
        );
      })}
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

      <StageBar />
      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <div role="region" aria-label={WORKSPACE_STEPS.find((s) => s.key === step)?.label} className="flex min-w-0 w-full flex-grow flex-col gap-5">
          <StepTabs />
          <Step />
        </div>
        <div className="w-full shrink-0 lg:sticky lg:top-20 lg:w-[280px]">
          <QaRail />
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
