"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { control, Field, textareaControl } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, REQUEST_LABELS, type CarrierMethod, type RequestStatus, type RequestType } from "@/lib/retention/servicing";
import { notify } from "@/lib/notify";

import { STEP_LABEL, localDay, policyHref, tryAgainHref, type FormStep } from "./servicing-shared";

/**
 * LA-5.4 · the client pieces of a servicing request (SvA, 2026-11-05): the cancel confirm (list row and
 * request page), the request page's header actions, and the step form that opens beside the timeline on
 * `?step=`. They were a side panel and a step pop-up; pop-ups are now only to confirm.
 */

async function postStep(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/servicing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "step", send: null, reference: null, confirmed_on: null, note: null, ...body }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
}

/** Cancel a request: asks why (three characters or more), then steps it to cancelled. */
export function CancelRequestDialog({ id, name, open, onOpenChange, onDone }: { id: string; name: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await postStep({ id, to: "cancelled", note: why.trim() });
      notify.done("Cancelled.");
      setWhy("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!next) { setError(null); } onOpenChange(next); }}
      onConfirm={() => void cancel()}
      busy={busy}
      title="Cancel the request?"
      description={`${name}: nothing more is asked of the carrier, and the request stops waiting on a file.`}
      cancelLabel="Keep the request"
      confirmLabel={busy ? "Cancelling…" : "Cancel the request"}
      confirmDisabled={why.trim().length < 3}
      fields={<>
        <Field label="Why" htmlFor={`cancel-why-${id}`} required>
          <textarea id={`cancel-why-${id}`} className={textareaControl} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      </>}
    />
  );
}

/** The request page's header: the next step as the one button, the rest under More. */
export function ServicingRequestActions({ id, name, next, cancellable, failed, carrierId, policyNumber, type }: {
  id: string; name: string; next: FormStep | null; cancellable: boolean; failed: boolean; carrierId: string; policyNumber: string; type: RequestType;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  return (
    <>
      {next && <Button asChild><Link href={`/app/servicing/${id}?step=${next}`}>{STEP_LABEL[next]}</Link></Button>}
      <MoreMenu items={[
        cancellable && { label: "Cancel the request", onSelect: () => setCancelling(true) },
        failed && { label: "Try again", href: tryAgainHref({ carrierId, policyNumber, type }) },
        { label: "Open the policy", href: policyHref({ carrierId, policyNumber }) },
      ]} />
      {cancellable && <CancelRequestDialog id={id} name={name} open={cancelling} onOpenChange={setCancelling} onDone={() => { setCancelling(false); router.replace(`/app/servicing/${id}`); router.refresh(); }} />}
    </>
  );
}

/** One step's fields, on the page beside the timeline (was StepDialog). */
export function ServicingStepForm({ id, to, type, carrierMethod, carrierReference, expectedEffectiveDate }: {
  id: string; to: FormStep; type: RequestType; carrierMethod: CarrierMethod | null; carrierReference: string | null; expectedEffectiveDate: string | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<CarrierMethod | "">(carrierMethod ?? "");
  const [reference, setReference] = useState(carrierReference ?? "");
  const [formRef, setFormRef] = useState("");
  const [effective, setEffective] = useState(expectedEffectiveDate ?? "");
  const [confirmedOn, setConfirmedOn] = useState(() => localDay());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = to === "submitted" ? method !== "" : to === "confirmed_by_carrier" ? confirmedOn !== "" : true;
  const back = `/app/servicing/${id}`;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await postStep({
        id, to: to as RequestStatus,
        send: to === "submitted" ? { method, form_ref: formRef.trim() || null, reference: reference.trim() || null, expected_effective_date: effective || null } : null,
        reference: to !== "submitted" ? reference.trim() || null : null,
        confirmed_on: to === "confirmed_by_carrier" ? confirmedOn : null,
      });
      notify.done(to === "confirmed_by_carrier" ? "Noted. It stays open until a carrier file shows the change." : "Saved.");
      router.replace(back);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void save(); }}>
      <h2 className="m-0 text-base font-semibold text-foreground">{STEP_LABEL[to]}: {REQUEST_LABELS[type].toLowerCase()}</h2>
      {to === "submitted" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How" htmlFor="step-via" required>
            <select id="step-via" className={control} value={method} onChange={(e) => setMethod(e.target.value as CarrierMethod | "")}>
              <option value="">Choose…</option>
              {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
          <Field label="Their reference" htmlFor="step-ref"><input id="step-ref" autoComplete="off" className={control} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Form used" htmlFor="step-form"><input id="step-form" autoComplete="off" className={control} value={formRef} onChange={(e) => setFormRef(e.target.value)} /></Field>
          <Field label="Takes effect by" htmlFor="step-effective"><input id="step-effective" type="date" className={control} value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
        </div>
      )}
      {(to === "awaiting_carrier" || to === "confirmed_by_carrier") && (
        <Field label="Their reference" htmlFor="step-ref2"><input id="step-ref2" autoComplete="off" className={control} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      )}
      {to === "confirmed_by_carrier" && (
        <>
          <Field label="They said it was done on" htmlFor="step-on" required><input id="step-on" type="date" className={control} value={confirmedOn} onChange={(e) => setConfirmedOn(e.target.value)} /></Field>
          <p className="m-0 text-sm text-muted-foreground">This is what you were told. The request closes only when a carrier file shows the change.</p>
        </>
      )}
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline"><Link href={back}>Back</Link></Button>
        <Button type="submit" disabled={!ready || busy}>{busy ? "Saving…" : STEP_LABEL[to]}</Button>
      </div>
    </form>
  );
}
