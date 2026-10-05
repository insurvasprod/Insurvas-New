"use client";

/**
 * /app/applications/[caseId] — the application workspace (LA-3; boards l3-ws-*). One case, its
 * attempts, one step at a time: the numbered step rail on the left, the step's card in the middle,
 * the live pre-submission check on the right of every step. Inbound, outbound and lead-detail all
 * open this same page (build it once).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
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
const READ_ONLY_TITLE = "This attempt is closed, so nothing on it can change";

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

function StepRail() {
  const ws = useWorkspace();
  const { step, goTo, attempt } = ws;
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  return (
    <nav aria-label="Application steps" className="w-full shrink-0 lg:w-[186px]">
      <div className="flex flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-col p-2.5">
          {NUMBERED.map((s, i) => {
            const active = step === s.key;
            const done = !active && stepDone(s.key, ws);
            const locked = s.key === "after" && !submitted;
            return (
              <button
                key={s.key}
                type="button"
                aria-current={active ? "step" : undefined}
                disabled={locked}
                title={locked ? "Opens once the application is submitted" : undefined}
                onClick={() => goTo(s.key)}
                className={cn(
                  "flex h-[34px] items-center gap-[9px] rounded-[8px] px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "bg-[var(--brand-50)] font-semibold text-[var(--accent-ink)]" : done ? "text-[var(--body)] hover:bg-[var(--surface-alt)]" : "text-[var(--muted)] hover:bg-[var(--surface-alt)]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    active ? "bg-[var(--primary)] text-[var(--ink)]" : done ? "bg-[var(--success)] text-white" : "bg-[var(--surface-alt)] text-[var(--muted)]",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {s.label}
                {done && <span className="sr-only"> (done)</span>}
              </button>
            );
          })}
          <button
            type="button"
            aria-current={step === "timeline" ? "step" : undefined}
            onClick={() => goTo("timeline")}
            className={cn(
              "mt-1 flex items-center border-t border-[var(--border)] px-2.5 pt-2.5 pb-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              step === "timeline" ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--body)] hover:text-[var(--ink)]",
            )}
          >
            Case timeline
          </button>
        </div>
      </div>
    </nav>
  );
}

function Workspace() {
  const ws = useWorkspace();
  const { caseView, attempt, attemptsForInsured, insured, step, readOnly, sample, selectAttempt } = ws;
  const [spouseOpen, setSpouseOpen] = useState(false);
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
      <Link href="/app/applications" className="-mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />Applications
      </Link>
      <PageHeader
        title={insured === "spouse" ? ((spouseName || spouseOption) ? `${spouseName || spouseOption} · spouse` : `${caseView.clientName}'s spouse`) : caseView.clientName}
        actions={<>
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
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <AttemptStatusChip status={attempt.status} outcome={attempt.outcome} />
        {attemptsForInsured.length > 0 && (
          <select aria-label="Attempt" className={toolbarControl} value={attempt.attemptNo} onChange={(e) => selectAttempt(Number(e.target.value))}>
            {attemptsForInsured.map((a) => <option key={a.id} value={a.attemptNo}>Attempt {a.attemptNo} · {a.carrierName ?? "no carrier yet"}</option>)}
          </select>
        )}
        {household && (
          <select aria-label="Insured" className={toolbarControl} value={insured} onChange={(e) => selectAttempt(0, e.target.value as "primary" | "spouse")}>
            <option value="primary">{caseView.clientName}</option>
            <option value="spouse">{spouseOption ? `${spouseOption} (spouse)` : "Spouse"}</option>
          </select>
        )}
        {productChip && <StatusChip tone="neutral" dot>{productChip}</StatusChip>}
        {household && <StatusChip tone="info">Household · {liveInsureds} applications</StatusChip>}
      </div>
      {sample && <SampleDataNotice />}
      {/* Both sides and the combined premium, on every step of a household case (LA-3.24). */}
      {household && <HouseholdHeader caseView={caseView} insured={insured} />}

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <StepRail />
        <div role="region" aria-label={WORKSPACE_STEPS.find((s) => s.key === step)?.label} className="flex min-w-0 w-full flex-grow flex-col gap-5">
          <Step />
        </div>
        <div className="w-full shrink-0 lg:sticky lg:top-20 lg:w-[268px]">
          <QaRail />
        </div>
      </div>
      <AddSpouseDialog open={spouseOpen} onOpenChange={setSpouseOpen} />
    </div>
  );
}

export function ApplicationWorkspace({ initial, sample, timeZone }: { initial: CaseView; sample: boolean; timeZone?: string }) {
  return (
    <WorkspaceProvider key={initial.caseId} initial={initial} sample={sample} timeZone={timeZone}>
      <Workspace />
    </WorkspaceProvider>
  );
}
