"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, canStep, type CarrierMethod, type RequestStatus } from "@/lib/retention/servicing";
import { notify } from "@/lib/notify";

import { localDay } from "./servicing-shared";

/**
 * LA-5.4 · the client pieces of a servicing request (round 7, owner pick 2·1–2·2, 2026-11-10). The request page is a
 * server page; this island holds its title line's primary and ⋯, and the steps' dialogs:
 *   Mark sent   (Send it)    md dialog: how you asked, their reference, takes effect by, form used.
 *   Check it    (Check it)   md dialog: what the carrier said, the day they said it was done, their reference.
 *   Cancel the request (⋯)   the shared confirm.
 * The title line's primary and the step's own button on "Where it stands" open the same dialog (StepButton), and
 * `?step=` opens one on arrival (the old links). An error the person can fix stays on the dialog's error line,
 * never a toast; the toasts say what happened, in board 2·2's words.
 */

type DialogKey = "send" | "check" | "cancel";

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/servicing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
}
const postStep = (body: Record<string, unknown>) => post({ action: "step", send: null, reference: null, confirmed_on: null, note: null, ...body });
const postNote = (id: string, note: string) => post({ action: "note", id, note });
const failed = (e: unknown) => (e instanceof Error ? e.message : "That could not be saved.");

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>;
}

/** What a request's dialogs need to know about it. */
export type RequestFacts = {
  id: string;
  /** The client, as the title says it. */
  name: string;
  status: RequestStatus;
  carrierName: string;
  /** The change in words: "Address → 1180 Pine Ridge Rd · ZIP 80014 · CO". */
  change: string;
  /** "address change", for the cancel confirm. */
  kind: string;
  carrierMethod: CarrierMethod | null;
  carrierReference: string | null;
  formRef: string | null;
  expectedEffectiveDate: string | null;
};

const Ctx = createContext<((key: DialogKey) => void) | null>(null);

/**
 * Wraps the request page so its title line and its body open the same dialogs. `back` is the page's own address
 * without `?step=`, where a saved step lands.
 */
export function ServicingRequestShell({ request: facts, back, initial, children }: { request: RequestFacts; back: string; initial: DialogKey | null; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogKey | null>(initial);
  const close = () => {
    setOpen(null);
    if (initial) router.replace(back, { scroll: false });
  };
  const done = () => {
    setOpen(null);
    router.replace(back, { scroll: false });
    router.refresh();
  };
  return (
    <Ctx.Provider value={setOpen}>
      {children}
      {open === "send" && <MarkSentDialog facts={facts} onClose={close} onDone={done} />}
      {open === "check" && <CheckItDialog facts={facts} onClose={close} onDone={done} />}
      <CancelRequestDialog id={facts.id} name={facts.name} kind={facts.kind} open={open === "cancel"} onOpenChange={(next) => { if (!next) close(); }} onDone={done} />
    </Ctx.Provider>
  );
}

/** A button that opens one of the request's dialogs: the title line's primary, or a step's own button. */
export function StepButton({ step, label, variant = "default", size = "default" }: { step: DialogKey; label: string; variant?: "default" | "outline"; size?: "default" | "sm" }) {
  const openDialog = useContext(Ctx);
  return <Button type="button" variant={variant} size={size} onClick={() => openDialog?.(step)}>{label}</Button>;
}

/**
 * The title line after ‹ ›: the primary by state (Send it → Mark sent, Check it → Check it, Not in the file → Try
 * again), then ⋯ with Cancel the request, Open the policy and Open the case. Read-only keeps ⋯ › Open the policy.
 */
export function ServicingRequestActions({ primary, tryAgainHref, policyHref, caseHref, cancellable, readOnly }: {
  primary: "send" | "check" | "failed" | null;
  tryAgainHref: string;
  policyHref: string;
  caseHref: string | null;
  cancellable: boolean;
  readOnly: boolean;
}) {
  const openDialog = useContext(Ctx);
  return (
    <>
      {!readOnly && primary === "send" && <StepButton step="send" label="Mark sent" />}
      {!readOnly && primary === "check" && <StepButton step="check" label="Check it" />}
      {!readOnly && primary === "failed" && <Button asChild><Link href={tryAgainHref}>Try again</Link></Button>}
      <MoreMenu items={[
        !readOnly && cancellable && { label: "Cancel the request", onSelect: () => openDialog?.("cancel") },
        { label: "Open the policy", href: policyHref },
        !readOnly && caseHref && { label: "Open the case", href: caseHref },
      ]} />
    </>
  );
}

/** Cancel a request (⋯): the shared confirm, board 2·2's words. Nothing is sent to the carrier. */
export function CancelRequestDialog({ id, name, kind, open, onOpenChange, onDone }: { id: string; name: string; kind: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await postStep({ id, to: "cancelled", note: "Cancelled by a person." });
      notify.done("Cancelled.");
      onDone();
    } catch (e) {
      setError(failed(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => { if (!next) setError(null); onOpenChange(next); }}
      onConfirm={() => void cancel()}
      busy={busy}
      title="Cancel the request?"
      description={`${name}'s ${kind} stops being tracked. Nothing is sent to the carrier.`}
      cancelLabel="Keep the request"
      confirmLabel={busy ? "Cancelling…" : "Cancel the request"}
      fields={error ? <ErrorLine error={error} /> : undefined}
    />
  );
}

/** Mark sent (Send it): how you asked the carrier and what they gave you. It stays open until a file shows it. */
function MarkSentDialog({ facts, onClose, onDone }: { facts: RequestFacts; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<CarrierMethod | "">(facts.carrierMethod ?? "");
  const [reference, setReference] = useState(facts.carrierReference ?? "");
  const [formRef, setFormRef] = useState(facts.formRef ?? "");
  const [effective, setEffective] = useState(facts.expectedEffectiveDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!method) { setError("Say how you asked the carrier."); return; }
    setBusy(true);
    setError(null);
    try {
      await postStep({ id: facts.id, to: "submitted", send: { method, form_ref: formRef.trim() || null, reference: reference.trim() || null, expected_effective_date: effective || null } });
      notify.done("Sent. It stays open until a carrier file shows the change.");
      onDone();
    } catch (e) {
      setError(failed(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{`Mark ${facts.name}'s request sent`}</DialogTitle>
          <DialogDescription>{facts.change}</DialogDescription>
        </DialogHeader>
        <form id="servicing-mark-sent" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
          <Field label="How you asked" required>
            <div role="radiogroup" aria-label="How you asked" className="mt-1.5 flex flex-wrap gap-2">
              {CARRIER_METHODS.map((m) => <ToggleChip key={m} role="radio" selected={method === m} onClick={() => { setMethod(m); setError(null); }}>{CARRIER_METHOD_LABELS[m]}</ToggleChip>)}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Their reference" htmlFor="sent-ref"><input id="sent-ref" autoComplete="off" placeholder="Optional" className={control} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Takes effect by" htmlFor="sent-effective"><input id="sent-effective" type="date" className={control} value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
          </div>
          <Field label="Form used" htmlFor="sent-form"><input id="sent-form" autoComplete="off" placeholder="Optional" className={control} value={formRef} onChange={(e) => setFormRef(e.target.value)} /></Field>
          <ErrorLine error={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Back</Button>
          <Button type="submit" form="servicing-mark-sent" disabled={busy}>{busy ? "Saving…" : "Record as sent"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Said = "done" | "not_yet" | "refused";
const SAID: Array<{ key: Said; label: string }> = [{ key: "done", label: "It's done" }, { key: "not_yet", label: "Not done yet" }, { key: "refused", label: "They refused it" }];

/**
 * Check it: what the carrier said. "It's done" records the day they gave (carrier says done); "Not done yet" marks
 * the carrier on it; once a step can't take either, what they said is kept as a dated note. "They refused it" stops
 * the request (cancelled, with the reason). It never closes a request as proven: only a carrier file does that.
 */
function CheckItDialog({ facts, onClose, onDone }: { facts: RequestFacts; onClose: () => void; onDone: () => void }) {
  const [said, setSaid] = useState<Said>("done");
  const [confirmedOn, setConfirmedOn] = useState(() => localDay());
  const [reference, setReference] = useState(facts.carrierReference ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (said === "done" && !confirmedOn) { setError("Say the day they said it was done."); return; }
    setBusy(true);
    setError(null);
    const ref = reference.trim() || null;
    const refText = ref ? `, ref ${ref}` : "";
    try {
      if (said === "refused") {
        await postStep({ id: facts.id, to: "cancelled", reference: ref, note: `${facts.carrierName} refused it${refText}.` });
        notify.done("Cancelled.");
      } else if (said === "done") {
        if (canStep(facts.status, "confirmed_by_carrier")) await postStep({ id: facts.id, to: "confirmed_by_carrier", reference: ref, confirmed_on: confirmedOn });
        else await postNote(facts.id, `${facts.carrierName} said it was done on ${confirmedOn}${refText}.`);
        notify.done("Noted. It stays open until a carrier file shows the change.");
      } else {
        if (canStep(facts.status, "awaiting_carrier")) await postStep({ id: facts.id, to: "awaiting_carrier", reference: ref });
        else await postNote(facts.id, `${facts.carrierName} said it isn't done yet${refText}.`);
        notify.done("Noted. It stays open until a carrier file shows the change.");
      }
      onDone();
    } catch (e) {
      setError(failed(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{`What did ${facts.carrierName} say?`}</DialogTitle>
          <DialogDescription className="sr-only">{facts.change}</DialogDescription>
        </DialogHeader>
        <form id="servicing-check-it" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!busy) void save(); }}>
          <div role="radiogroup" aria-label="What the carrier said" className="flex flex-wrap gap-2">
            {SAID.map((s) => <ToggleChip key={s.key} role="radio" selected={said === s.key} onClick={() => { setSaid(s.key); setError(null); }}>{s.label}</ToggleChip>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {said === "done" && <Field label="They said it was done on" htmlFor="check-on" required><input id="check-on" type="date" className={control} value={confirmedOn} onChange={(e) => setConfirmedOn(e.target.value)} /></Field>}
            <Field label="Their reference" htmlFor="check-ref"><input id="check-ref" autoComplete="off" placeholder="Optional" className={control} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            {said === "refused" ? "The request is cancelled: nothing more is asked of the carrier." : "This is what you were told. The request closes only when a carrier file shows the change."}
          </p>
          <ErrorLine error={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Back</Button>
          <Button type="submit" form="servicing-check-it" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
