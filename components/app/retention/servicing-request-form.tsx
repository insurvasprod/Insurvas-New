"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cardInset, cardSurface } from "@/components/ui/card";
import { checkboxControl, control, Field, textareaControl } from "@/components/ui/field";
import { SectionLoading } from "@/components/ui/page-states";
import { CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, PAYMENT_METHODS, type ContactOutcome, type PaymentMethod } from "@/lib/retention/constants";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, REQUEST_LABELS, type CarrierMethod, type Origin, type RequestType } from "@/lib/retention/servicing";
import type { Prefill } from "@/lib/retention/servicingStore";
import { personName } from "@/lib/format/personName";
import { notify } from "@/lib/notify";

const METHOD_WORDS: Record<PaymentMethod, string> = { bank_draft: "Bank draft", direct_express: "Direct Express card", card: "Debit or credit card", direct_bill: "Mailed bill" };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * LA-5.4 · open a servicing request, on the page (the pick of 2026-11-05: the Fix tab of a save card, the
 * paper-bill call and New request; it was a pop-up). Pre-filled from the server: the current draft day,
 * LA-3.9's recommended day with the sentence the agent can read to the client, and the carrier's own
 * instructions. From a save-queue card it also logs the call (LA-5.3) and links the two.
 *
 * `onDone` gets the new request's id.
 */
export function ServicingRequestForm({ carrierId, policyNumber, type, origin, fromQueue, initialOutcome = "reached_agreed", onCancel, onDone }: {
  carrierId: string;
  policyNumber: string;
  type: RequestType;
  origin: Origin;
  fromQueue: boolean;
  initialOutcome?: ContactOutcome;
  onCancel?: () => void;
  onDone: (id: string | null) => void;
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<number | "">("");
  const [toMethod, setToMethod] = useState<PaymentMethod | "">("");
  const [last4, setLast4] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [state, setState] = useState("");
  const [outcome, setOutcome] = useState<ContactOutcome>(initialOutcome);
  const [sendNow, setSendNow] = useState(true);
  const [method, setMethod] = useState<CarrierMethod | "">("");
  const [reference, setReference] = useState("");
  const [formRef, setFormRef] = useState("");
  const [effective, setEffective] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/app/retention/servicing?carrier_id=${carrierId}&policy_number=${encodeURIComponent(policyNumber)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "The policy could not be read.");
        return data as Prefill;
      })
      .then((p) => {
        if (!live) return;
        setPrefill(p);
        if (p.recommendedDraftDay) setDay(p.recommendedDraftDay);
        const g = p.guides[type];
        if (g?.method) setMethod(g.method);
        if (g?.formRef) setFormRef(g.formRef);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : "The policy could not be read."));
    return () => { live = false; };
  }, [carrierId, policyNumber, type]);

  const guide = prefill?.guides[type] ?? null;
  const openSame = prefill?.open.find((o) => o.type === type) ?? null;

  function change() {
    if (type === "draft_date_change") return { type, target_draft_day: day === "" ? null : day };
    if (type === "bill_to_draft_conversion") return { type, target_draft_day: day === "" ? null : day };
    if (type === "payment_method_change") return { type, to_method: toMethod || null, account_last4: last4.trim() || null };
    return { type, address: address.trim() || null, zip: zip.trim() || null, state: state.trim() || null };
  }
  const ready = prefill && !openSame && (type !== "draft_date_change" || day !== "") && (!sendNow || method !== "") && (type !== "payment_method_change" || toMethod !== "" || /^\d{4}$/.test(last4)) && (type !== "address_change" || address.trim() || zip.trim() || state.trim());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/servicing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", carrier_id: carrierId, policy_number: policyNumber, origin, change: change(),
          send: sendNow ? { method, form_ref: formRef.trim() || null, reference: reference.trim() || null, expected_effective_date: effective || null } : null,
          note: note.trim() || null, from_queue: fromQueue ? { outcome } : null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!response.ok) throw new Error(data.error ?? "The request could not be opened.");
      notify.done(sendNow ? "Sent. It stays open until a carrier file shows the change." : "Saved as not sent yet. Mark it sent when you have asked the carrier.");
      onDone(data.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className={`${cardSurface} p-5`}><p className="m-0 text-sm text-[var(--error-ink)]">{loadError}</p></div>;
  if (!prefill) return <div className={`${cardSurface} p-5`}><SectionLoading rows={3} columns={2} label="Reading the policy" /></div>;

  return (
    <form className={`${cardSurface} flex flex-col gap-4 p-5`} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void save(); }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold text-foreground">{REQUEST_LABELS[type]}{prefill.clientName ? ` for ${personName(prefill.clientName)}` : ""}</h2>
        <span className="text-xs text-muted-foreground">{prefill.carrierName} · {policyNumber} · open until a carrier file shows the change</span>
      </div>
      {openSame && <p className="m-0 text-sm text-[var(--warning-ink)]">This policy already has an open request of this kind. Finish or cancel it on Servicing first.</p>}

      <div className={`${cardInset} px-3 py-2 text-sm`}>
        <span className="block font-semibold text-foreground">How {prefill.carrierName} does it</span>
        {guide ? (
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted-foreground">
            {guide.method && <li>{CARRIER_METHOD_LABELS[guide.method]}{guide.whereToDoIt ? `: ${guide.whereToDoIt}` : ""}</li>}
            {!guide.method && guide.whereToDoIt && <li>{guide.whereToDoIt}</li>}
            {guide.whatTheyNeed && <li>They ask for: {guide.whatTheyNeed}</li>}
            {guide.clientMustAuthorise !== null && <li>{guide.clientMustAuthorise ? "The client has to authorise it." : "No client authorisation needed."}</li>}
            {guide.formRef && <li>Form: {guide.formRef}</li>}
            {guide.notes && <li>{guide.notes}</li>}
          </ul>
        ) : (
          <span className="block text-muted-foreground">No instructions for {prefill.carrierName} yet. Insurvas adds them; ask the carrier how they take this change.</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(type === "draft_date_change" || type === "bill_to_draft_conversion") && (
          <Field
            label={type === "draft_date_change" ? `New payment date${prefill.currentDraftDay ? ` (now the ${ordinal(prefill.currentDraftDay)})` : ""}` : "Draft day (optional)"}
            htmlFor="svc-day"
            hint={day !== "" && day === prefill.recommendedDraftDay && prefill.recommendedReason ? <>Read to the client: &ldquo;{prefill.recommendedReason}&rdquo;</>
              : day !== "" && prefill.recommendedDraftDay && day !== prefill.recommendedDraftDay ? `The recommended day is the ${ordinal(prefill.recommendedDraftDay)}.`
                : !prefill.recommendedDraftDay ? "No recommendation: when their money arrives isn't known. Ask, and set it in Draft dates." : undefined}
          >
            <select id="svc-day" className={control} value={day} onChange={(e) => setDay(e.target.value ? Number(e.target.value) : "")}>
              {type === "bill_to_draft_conversion" && <option value="">The carrier&apos;s default</option>}
              {type === "draft_date_change" && day === "" && <option value="">Choose a day</option>}
              {DAYS.map((d) => <option key={d} value={d}>{ordinal(d)}{d === prefill.recommendedDraftDay ? " (recommended)" : ""}</option>)}
            </select>
          </Field>
        )}
        {type === "payment_method_change" && (
          <>
            <Field label={`Pay by${prefill.paymentMethod ? ` (now: ${METHOD_WORDS[prefill.paymentMethod]})` : ""}`} htmlFor="svc-method">
              <select id="svc-method" className={control} value={toMethod} onChange={(e) => setToMethod(e.target.value as PaymentMethod | "")}>
                <option value="">No change of method</option>
                {PAYMENT_METHODS.filter((m) => m !== prefill.paymentMethod).map((m) => <option key={m} value={m}>{METHOD_WORDS[m]}</option>)}
              </select>
            </Field>
            <Field label="New account or card, last four digits" htmlFor="svc-last4" hint="Only the last four. The full number goes to the carrier, never here.">
              <input id="svc-last4" inputMode="numeric" autoComplete="off" maxLength={4} className={control} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </>
        )}
        {type === "address_change" && (
          <>
            <Field label="Street address" htmlFor="svc-address" className="sm:col-span-2"><input id="svc-address" autoComplete="off" className={control} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="ZIP" htmlFor="svc-zip"><input id="svc-zip" inputMode="numeric" autoComplete="off" className={control} value={zip} onChange={(e) => setZip(e.target.value)} /></Field>
            <Field label="State" htmlFor="svc-state"><input id="svc-state" autoComplete="off" maxLength={2} className={control} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} /></Field>
          </>
        )}
        {fromQueue && (
          <Field label="The call" htmlFor="svc-outcome">
            <select id="svc-outcome" className={control} value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)}>
              {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{CONTACT_OUTCOME_LABELS[o]}</option>)}
            </select>
          </Field>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <input type="checkbox" className={checkboxControl} checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
        I have sent it to the carrier
      </label>
      {sendNow && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="How" htmlFor="svc-via" required>
            <select id="svc-via" className={control} value={method} onChange={(e) => setMethod(e.target.value as CarrierMethod | "")}>
              <option value="">Choose…</option>
              {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
          <Field label="Their reference" htmlFor="svc-ref"><input id="svc-ref" autoComplete="off" className={control} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Form used" htmlFor="svc-form"><input id="svc-form" autoComplete="off" className={control} value={formRef} onChange={(e) => setFormRef(e.target.value)} /></Field>
          <Field label="Takes effect by" htmlFor="svc-effective"><input id="svc-effective" type="date" className={control} value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
        </div>
      )}

      <Field label="Note" htmlFor="svc-note"><textarea id="svc-note" className={textareaControl} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {/* On a page a Callout goes to the bell: an error the user must fix stays beside the button (§11). */}
      {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={!ready || busy}>{busy ? "Saving…" : sendNow ? "Record as sent" : "Save, send later"}</Button>
      </div>
    </form>
  );
}
