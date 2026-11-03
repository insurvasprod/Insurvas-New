"use client";

/**
 * Submit (step 9; board l3-ws-submit): copy the application onto the carrier's form with copy-assist
 * (LA-3.14), then capture what its confirmation said (LA-3.15, the capture overlay l3-ov-capture).
 * Only a `ready` attempt can be captured.
 *
 * Owner 2026-10-29: two sections only. The extension's "Fill on carrier site" card is hidden until the
 * extension is switched on, the "Submit it on their site" step is gone (Record says it), and the
 * welcome pack (LA-3.20) is off for now. Copy-assist folds whenever the agent wants, finished or not,
 * and its Next folds it and goes to Record.
 */

import { useState } from "react";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import type { SubmissionView } from "@/lib/applications/types";

import { QaVerdictChip } from "@/components/app/applications/parts";
import { CopyAssistPanel } from "@/components/app/applications/copy-assist/copy-assist-panel";
import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { AttachedFile, PasteBox, useAttachment, useFilePicker } from "@/components/app/applications/submit/attachment-field";
import { dateTime, SUBMITTED_VIA_LABEL } from "@/components/app/applications/submit/labels";
import { useReferenceExample } from "@/components/app/applications/submit/reference-check";
import { SubmissionDialog, toLocalInput, type CaptureSeed } from "@/components/app/applications/submit/submission-dialog";
import { useExtensionDetected } from "@/components/app/applications/submit/use-extension";
import { WelcomePackPanel } from "@/components/app/applications/submit/welcome-pack-panel";
import { Warning } from "@/components/app/applications/submit/warning-line";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { BareStepCards, StepCard } from "@/components/app/applications/workspace/step-card";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";

/** The welcome pack (LA-3.20) is off for now (owner 2026-10-29); true brings its section back. */
const WELCOME_PACK_ON = false;

export function SubmitStep() {
  const { attempt } = useWorkspace();
  // Keyed by attempt: a pasted screenshot or a half-typed reference never follows the agent to another attempt.
  return <SubmitBody key={attempt.id} />;
}

function SubmitBody() {
  const { caseView, attempt, sample, readOnly, goTo, timeZone } = useWorkspace();
  const extension = useExtensionDetected();
  const example = useReferenceExample(attempt.id, sample);
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  const ready = attempt.status === "ready" || (sample && attempt.status === "draft");
  const carrier = attempt.carrierName ?? "the carrier";
  // Copy-assist is open until the agent folds it (its header, or Next); once captured it starts folded.
  const [copyFolded, setCopyFolded] = useState(submitted);

  const [reference, setReference] = useState("");
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const shot = useAttachment();
  const picker = useFilePicker((f) => shot.set(f, "chosen"));
  const [seed, setSeed] = useState<CaptureSeed | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState<SubmissionView | null>(null);

  function capture() {
    setSeed({ reference, submittedAt: at, attachment: shot.value });
    setEditing(null);
    setCapturing(true);
  }

  async function viewConfirmation(s: SubmissionView) {
    if (sample) { notify.done("Sample data — there is no stored confirmation."); return; }
    const r = await request<{ url: string }>(attemptUrl(attempt.id, `/submissions/${s.id}/confirmation`));
    if (!r.ok) { notify.block(r.error); return; }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  const subs = [...attempt.submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return (
    <section aria-label="Submit" className="m-glass flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] p-[18px]">
      {/* Two numbered sections (owner 2026-10-29): copy it onto their form, then record what they gave you. */}
      <BareStepCards>
        <FoldSection heading="1 · Copy-assist" done={submitted ? 1 : 0} total={1} complete={submitted} progressLabel={ready ? "Copy each field to their form" : "Mark it ready on Review first"} completeLabel="Done" folded={copyFolded} onFoldedChange={setCopyFolded}>
          <CopyAssistPanel attempt={attempt} caseId={caseView.caseId} sample={sample} onNext={() => setCopyFolded(true)} />
        </FoldSection>

        <FoldSection heading="2 · Record what they gave you" done={submitted ? 1 : 0} total={1} complete={false} progressLabel={submitted ? "Captured" : "Not captured yet"}>
        <StepCard
          title="2 · Record what they gave you"
          chips={submitted ? <StatusChip tone="good">Captured</StatusChip> : <StatusChip tone="action" dot={false}>Not captured yet</StatusChip>}
          footerNote={submitted ? "Recorded. The QA verdict was frozen with it." : `Submit on ${carrier}'s own site, then capture what its confirmation says: the application number and a screenshot.`}
          actions={<>
            <Button type="button" variant="outline" onClick={() => goTo("review")}><ArrowLeft aria-hidden="true" />Back to Review</Button>
            <Button type="button" onClick={() => goTo("after")} disabled={!submitted} title={submitted ? undefined : "Capture the submission first"}>Continue to After submit<ArrowRight aria-hidden="true" /></Button>
          </>}
        >
          {submitted ? (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {subs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-[180px] flex-1">
                    {s.carrierReference
                      ? <span className="block font-mono text-sm font-semibold text-[var(--ink)]">{s.carrierReference}</span>
                      : <StatusChip tone="warning">Missing reference</StatusChip>}
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{dateTime(s.submittedAt, timeZone)} · {SUBMITTED_VIA_LABEL[s.submittedVia]}{s.policyNumber && s.policyNumber !== s.carrierReference ? ` · policy ${s.policyNumber}` : ""}</span>
                  </div>
                  <QaVerdictChip verdict={s.qaVerdict} />
                  <span className="flex gap-2">
                    {s.hasConfirmation
                      ? <Button type="button" variant="outline" size="sm" onClick={() => void viewConfirmation(s)}><FileText aria-hidden="true" />Confirmation</Button>
                      : !readOnly && <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(s); setSeed(null); setCapturing(true); }}>Attach confirmation</Button>}
                    {!s.carrierReference && !readOnly && <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(s); setSeed(null); setCapturing(true); }}>Add reference</Button>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4" onPaste={ready ? shot.onPaste : undefined}>
              {!ready && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">
                  <span>Mark the application ready on the Review step first.</span>
                  <Button type="button" variant="outline" onClick={() => goTo("review")}>Go to Review</Button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Carrier reference number" htmlFor="capture-reference" hint={example?.example ? `${example.carrierName ?? carrier} uses ${example.example}.` : "Copy it from the carrier's confirmation screen."}>
                  <input id="capture-reference" className={`${control} font-mono uppercase`} value={reference} onChange={(e) => setReference(e.target.value)} disabled={!ready || readOnly} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="Submitted at" htmlFor="capture-at">
                  <input id="capture-at" type="datetime-local" className={control} value={at} onChange={(e) => setAt(e.target.value)} disabled={!ready || readOnly} />
                </Field>
                <div className="sm:col-span-2">
                  {shot.value ? (
                    <div className="flex flex-col gap-3">
                      <AttachedFile value={shot.value} onReplace={picker.open} onRemove={() => shot.set(null)} />
                      <Button type="button" className="self-start" onClick={capture} disabled={!ready || readOnly} title={readOnly ? "Read-only — nothing on this attempt can change" : !ready ? "Mark the application ready on the Review step first" : undefined}>Capture submission</Button>
                    </div>
                  ) : (
                    <PasteBox id="capture-confirmation" onFile={(f, how) => shot.set(f, how)} disabled={!ready || readOnly} disabledReason={readOnly ? "Read-only — nothing on this attempt can change" : "Mark the application ready on the Review step first"}>
                      <span title={readOnly ? "Read-only — nothing on this attempt can change" : ready ? undefined : "Mark the application ready on the Review step first"}>
                        <Button type="button" onClick={capture} disabled={!ready || readOnly}>Capture submission</Button>
                      </span>
                    </PasteBox>
                  )}
                  {picker.node}
                </div>
              </div>
              {ready && !reference.trim() && <Warning>You can capture without the reference — it then waits on the Missing reference list.</Warning>}
            </div>
          )}
        </StepCard>
        </FoldSection>

        {WELCOME_PACK_ON && (
          <FoldSection heading="Welcome pack" done={0} total={0} complete={false} progressLabel="For the client">
            <WelcomePackPanel attempt={attempt} sample={sample} readOnly={readOnly} />
          </FoldSection>
        )}
      </BareStepCards>

      <SubmissionDialog
        open={capturing}
        onOpenChange={setCapturing}
        existing={editing}
        extensionDetected={extension}
        seed={editing ? null : seed}
      />
    </section>
  );
}
