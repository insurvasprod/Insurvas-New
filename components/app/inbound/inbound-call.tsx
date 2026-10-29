"use client";

/**
 * The call (owner 2026-10-28): one page for steps 2–5 of Inbound, its content changing in place under
 * the one step bar — Transfer check, Verification, Underwriting (the application, inside the call) and
 * Finish the call. The address keeps the step (`?phase=`), so a reload or a shared link lands on it;
 * the bar's line fills and the new step rises in as the agent moves on. The application keeps its own
 * `?step=` beside it.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Callout } from "@/components/app/settings/primitives";
import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";
import { CALL_PHASES, phaseIndex, type CallPhase } from "@/lib/inbound/callPhase";
import { TransferCheck } from "@/components/app/inbound/transfer-check";
import { callHref } from "@/components/app/inbound/use-floor";
import { VerificationPanel } from "@/components/app/verification-panel";
import { DispositionWizard } from "@/components/app/disposition-wizard";
import { ApplicationWorkspace } from "@/components/app/applications/workspace/application-workspace";
import type { CaseView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

export type Underwriting =
  | { kind: "case"; view: CaseView; sample: boolean; timeZone?: string; seatReadOnly: boolean }
  | { kind: "open" }
  | { kind: "refused"; message: string };

export function InboundCall({ workItemId, phase, readOnly, canHandoff, canFinish, underwriting }: {
  workItemId: string;
  phase: CallPhase;
  readOnly: boolean;
  /** A screener: passes the call on instead of underwriting or finishing it. */
  canHandoff: boolean;
  /** Owners and agents record how the call ended. */
  canFinish: boolean;
  underwriting?: Underwriting;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Owner 2026-10-28: leaving the application (back to Verification, say) and coming back lands on the
  // step it was left at, not on Verify again. The case and its step are kept for this call in the tab.
  const memoryKey = `insurvas.call.${workItemId}.application`;
  // The design preview (?preview=sample, outside production) keeps itself across steps too.
  const preview = params.get("preview") === "sample";
  const appCase = phase === "underwriting" ? params.get("case") ?? (preview ? "sample" : null) : null;
  const appStep = phase === "underwriting" ? params.get("step") : null;
  useEffect(() => {
    if (!appCase) return;
    try { window.sessionStorage.setItem(memoryKey, JSON.stringify({ case: appCase, step: appStep })); } catch { /* not kept: it opens at Verify */ }
  }, [appCase, appStep, memoryKey]);
  const remembered = (caseId?: string) => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(memoryKey) ?? "null") as { case: string; step: string | null } | null;
      if (!saved || (caseId && saved.case !== caseId)) return caseId ? `case=${caseId}` : "";
      return `case=${saved.case}${saved.step ? `&step=${encodeURIComponent(saved.step)}` : ""}`;
    } catch { return caseId ? `case=${caseId}` : ""; }
  };
  const go = (next: CallPhase, extra = "") => {
    if (next === "underwriting") extra = remembered(/^case=([\w-]+)/.exec(extra)?.[1]);
    if (preview) extra = extra ? `${extra}&preview=sample` : "preview=sample";
    const href = callHref(workItemId, next);
    router.push(`${href}${extra ? `${href.includes("?") ? "&" : "?"}${extra}` : ""}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  let body: React.ReactNode;
  if (phase === "check") body = <TransferCheck workItemId={workItemId} onNext={() => go("verify")} />;
  else if (phase === "verify") body = <VerificationPanel workItemId={workItemId} readOnly={readOnly} canHandoff={canHandoff} onBack={() => go("check")} onUnderwrite={(caseId) => go("underwriting", `case=${caseId}`)} onFinish={() => go("finish")} />;
  else if (phase === "underwriting") body = <UnderwritingStep workItemId={workItemId} underwriting={underwriting} onFinish={() => go("finish")} />;
  else body = canFinish
    ? <DispositionWizard workItemId={workItemId} readOnly={readOnly} embedded />
    : <Callout tone="info" title="A licensed agent records how the call ended. Pass the call to one from Verification." />;

  // Verification and the application fill the screen's height and scroll inside (owner 2026-10-28):
  // no page scroll, the step's own content scrolls, the caller card / step rail stand the full height.
  const fill = phase === "verify" || (phase === "underwriting" && underwriting?.kind === "case");
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-4", fill && "lg:h-[calc(100dvh-var(--top-bar-h)-56px)]")}>
      <PageHeader title="Call" />
      <InboundStepBar current={phaseIndex(phase) as 1 | 2 | 3 | 4} onPick={(index) => go(CALL_PHASES[index - 1])} />
      <div key={phase} className={cn("flex min-w-0 flex-col motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both]", fill && "lg:min-h-0 lg:flex-1")}>
        {body}
      </div>
    </div>
  );
}

function UnderwritingStep({ workItemId, underwriting, onFinish }: { workItemId: string; underwriting?: Underwriting; onFinish: () => void }) {
  if (underwriting?.kind === "case") {
    return (
      <Suspense>
        <ApplicationWorkspace initial={underwriting.view} sample={underwriting.sample} timeZone={underwriting.timeZone} seatReadOnly={underwriting.seatReadOnly} onFinishCall={onFinish} />
      </Suspense>
    );
  }
  if (underwriting?.kind === "refused") return <Callout tone="info" title={underwriting.message} />;
  return <OpenApplication workItemId={workItemId} />;
}

/** Reached without the case in the address (a reload, a link): open or resume it, then land on it. */
function OpenApplication({ workItemId }: { workItemId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/app/applications/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { caseId?: string; error?: string } | null;
        if (!live) return;
        if (!response.ok || !result?.caseId) { setError(result?.error ?? "Could not open the application."); return; }
        router.replace(`${callHref(workItemId, "underwriting")}&case=${result.caseId}`, { scroll: false });
      })
      .catch(() => { if (live) setError("Could not open the application — check your connection."); });
    return () => { live = false; };
  }, [router, workItemId]);
  if (error) return <Callout tone="error" title={error} />;
  return <p role="status" className="m-0 flex items-center gap-2 text-sm text-[var(--body)]"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Opening the application…</p>;
}
