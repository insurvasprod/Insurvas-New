"use client";

/**
 * Submit (step 9; board l3-ws-submit): fill the carrier's form — with the extension (LA-3.12) or
 * copy-assist (LA-3.14) — submit on the carrier's own site, then capture what its confirmation said
 * (LA-3.15, the capture overlay l3-ov-capture). Only a `ready` attempt can be captured. The welcome
 * pack (LA-3.20) goes out once the capture is saved.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Wand2 } from "lucide-react";

import { Callout, Field, control } from "@/components/app/settings/primitives";
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
import { useExtensionDetected, useFillOnCarrierSite } from "@/components/app/applications/submit/use-extension";
import { Warning } from "@/components/app/applications/submit/warning-line";
import { WelcomePackPanel } from "@/components/app/applications/submit/welcome-pack-panel";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";

type Site = { carrierId: string; name: string; origin: string; fieldMap: "none" | "draft" | "published" | "needs_review" };

export function SubmitStep() {
  const { attempt } = useWorkspace();
  // Keyed by attempt: a pasted screenshot or a half-typed reference never follows the agent to another attempt.
  return <SubmitBody key={attempt.id} />;
}

/** The carrier's field-map status for the chip (LA-3.13), from the extension's site list. */
function useCarrierSite(carrierId: string | null, sample: boolean) {
  const [site, setSite] = useState<Site | null | undefined>(undefined);
  useEffect(() => {
    if (sample || !carrierId) return;
    let live = true;
    void request<{ sites: Site[] }>("/api/app/extension/grants").then((r) => {
      if (live) setSite(r.ok ? r.data.sites.find((s) => s.carrierId === carrierId) ?? null : null);
    });
    return () => { live = false; };
  }, [carrierId, sample]);
  return site;
}

const hostOf = (url: string | null | undefined) => {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
};

function SubmitBody() {
  const { caseView, attempt, sample, readOnly, goTo, timeZone } = useWorkspace();
  const extension = useExtensionDetected();
  const fill = useFillOnCarrierSite({ applicationId: attempt.id, carrierId: attempt.carrierId, carrierName: attempt.carrierName, sample });
  const site = useCarrierSite(attempt.carrierId, sample);
  const example = useReferenceExample(attempt.id, sample);
  const submitted = attempt.status !== "draft" && attempt.status !== "ready";
  const ready = attempt.status === "ready" || (sample && attempt.status === "draft");
  const carrier = attempt.carrierName ?? "the carrier";
  const host = hostOf(site?.origin) ?? hostOf(attempt.carrierPortalUrl);

  const [reference, setReference] = useState("");
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const shot = useAttachment();
  const picker = useFilePicker((f) => shot.set(f, "chosen"));
  const [seed, setSeed] = useState<CaptureSeed | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState<SubmissionView | null>(null);

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

  const mapChip = site === undefined || site === null
    ? null
    : site.fieldMap === "published" ? <StatusChip tone="good" dot={false}>Map published · {site.name}</StatusChip>
    : site.fieldMap === "needs_review" ? <StatusChip tone="warning" dot={false}>Map needs review</StatusChip>
    : site.fieldMap === "draft" ? <StatusChip tone="neutral" dot={false}>Map in draft</StatusChip>
    : <StatusChip tone="neutral" dot={false}>No field map</StatusChip>;
  const fillBlocked = submitted ? "Already submitted — the capture is below"
    : !ready ? "Mark the application ready on the Review step first"
    : !extension ? "Install the Insurvas extension to fill the carrier's form — or use copy-assist"
    : readOnly ? "This attempt is closed"
    : fill.busy ? "Opening the carrier's site…" : undefined;
  const fillTip = fillBlocked ?? `Opens ${host ?? "the carrier's site"} with a 60-minute token that covers this application only`;
  const subs = [...attempt.submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return (
    <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <StepCard title="Fill on the carrier site" chips={mapChip}>
          <div className="flex flex-wrap items-center gap-3">
            <span title={fillTip}>
              <Button type="button" onClick={fill.start} disabled={Boolean(fillBlocked)}>
                <Wand2 aria-hidden="true" />Fill on carrier site
              </Button>
            </span>
            <Button type="button" variant="outline" onClick={openPortal} disabled={!attempt.carrierPortalUrl} title={attempt.carrierPortalUrl ? undefined : "No portal address is on file for this carrier"}>
              <ExternalLink aria-hidden="true" />Open portal
            </Button>
          </div>
          {site?.fieldMap === "needs_review" && (
            <Callout tone="warning" title={`Some fields have no selector on ${carrier}'s form — they are left blank. Copy them from copy-assist.`} />
          )}
        </StepCard>

        <StepCard
          title="After you press submit on their site"
          chips={submitted ? <StatusChip tone="good">Captured</StatusChip> : <StatusChip tone="action" dot={false}>Not captured yet</StatusChip>}
          footerNote={submitted ? "Recorded. The QA verdict was frozen with it." : `Submit on ${carrier}'s own site first, then capture what its confirmation says.`}
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
                      <Button type="button" className="self-start" onClick={capture} disabled={!ready || readOnly} title={readOnly ? "This attempt is closed" : !ready ? "Mark the application ready on the Review step first" : undefined}>Capture submission</Button>
                    </div>
                  ) : (
                    <PasteBox id="capture-confirmation" onFile={(f, how) => shot.set(f, how)} disabled={!ready || readOnly} disabledReason={readOnly ? "This attempt is closed" : "Mark the application ready on the Review step first"}>
                      <span title={readOnly ? "This attempt is closed" : ready ? undefined : "Mark the application ready on the Review step first"}>
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

        <WelcomePackPanel attempt={attempt} sample={sample} readOnly={readOnly} />
      </div>

      <div className="w-full shrink-0 xl:w-[340px]">
        <CopyAssistPanel attempt={attempt} caseId={caseView.caseId} sample={sample} />
      </div>

      <SubmissionDialog
        open={capturing}
        onOpenChange={setCapturing}
        existing={editing}
        extensionDetected={extension}
        seed={editing ? null : seed}
      />
    </div>
  );
}
