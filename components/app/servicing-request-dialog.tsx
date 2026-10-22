"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, PAYMENT_METHODS, type ContactOutcome, type PaymentMethod } from "@/lib/retention/constants";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, REQUEST_LABELS, type CarrierMethod, type Origin, type RequestType } from "@/lib/retention/servicing";
import type { Prefill } from "@/lib/retention/servicingStore";
import { notify } from "@/lib/notify";

const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";
const METHOD_WORDS: Record<PaymentMethod, string> = { bank_draft: "Bank draft", direct_express: "Direct Express card", card: "Debit or credit card", direct_bill: "Mailed bill" };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
const alertClass = "rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]";

/**
 * LA-5.4 · open a servicing request. Pre-filled from the server: the current draft day, LA-3.9's
 * recommended day with the sentence the agent can read to the client, and the carrier's own
 * instructions. From a save-queue card it also logs the call (LA-5.3) and links the two.
 */
export function ServicingRequestDialog({ carrierId, policyNumber, type, origin, fromQueue, onClose, onDone }: {
  carrierId: string;
  policyNumber: string;
  type: RequestType;
  origin: Origin;
  fromQueue: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [day, setDay] = useState<number | "">("");
  const [toMethod, setToMethod] = useState<PaymentMethod | "">("");
  const [last4, setLast4] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [state, setState] = useState("");
  const [outcome, setOutcome] = useState<ContactOutcome>("reached_agreed");
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The request could not be opened.");
      notify.done(sendNow ? "Sent. It stays open until a carrier file shows the change." : "Saved as not sent yet. Mark it sent when you have asked the carrier.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{REQUEST_LABELS[type]}{prefill?.clientName ? ` for ${prefill.clientName}` : ""}</DialogTitle>
          <DialogDescription>{prefill ? `${prefill.carrierName} · ${policyNumber}. Open until a carrier file shows the change.` : policyNumber}</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className={alertClass}>{loadError}</p>
        ) : !prefill ? (
          <SectionLoading rows={3} columns={2} label="Reading the policy" />
        ) : (
          <div className="grid gap-4">
            {openSame && <p role="alert" className={alertClass}>This policy already has an open request of this kind. Finish or cancel it on the Servicing page first.</p>}

            <div className="rounded-lg border border-border px-3 py-2 text-sm">
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

            {(type === "draft_date_change" || type === "bill_to_draft_conversion") && (
              <label htmlFor="svc-day" className={labelClass}>
                {type === "draft_date_change" ? `New payment date${prefill.currentDraftDay ? ` (now the ${ordinal(prefill.currentDraftDay)})` : ""}` : "Draft day (optional)"}
                <select id="svc-day" className={field} value={day} onChange={(e) => setDay(e.target.value ? Number(e.target.value) : "")}>
                  {type === "bill_to_draft_conversion" && <option value="">The carrier&apos;s default</option>}
                  {type === "draft_date_change" && day === "" && <option value="">Choose a day</option>}
                  {DAYS.map((d) => <option key={d} value={d}>{ordinal(d)}{d === prefill.recommendedDraftDay ? " (recommended)" : ""}</option>)}
                </select>
                {day !== "" && day === prefill.recommendedDraftDay && prefill.recommendedReason && <span className="text-xs font-normal text-muted-foreground">Read to the client: &ldquo;{prefill.recommendedReason}&rdquo;</span>}
                {day !== "" && day !== prefill.recommendedDraftDay && prefill.recommendedDraftDay && <span className="text-xs font-normal text-muted-foreground">The recommended day is the {ordinal(prefill.recommendedDraftDay)}.</span>}
                {!prefill.recommendedDraftDay && <span className="text-xs font-normal text-muted-foreground">No recommendation: when their money arrives isn&apos;t known. Ask, and set it on the Draft dates page.</span>}
              </label>
            )}

            {type === "payment_method_change" && (
              <>
                <label htmlFor="svc-method" className={labelClass}>
                  Pay by{prefill.paymentMethod ? ` (now: ${METHOD_WORDS[prefill.paymentMethod]})` : ""}
                  <select id="svc-method" className={field} value={toMethod} onChange={(e) => setToMethod(e.target.value as PaymentMethod | "")}>
                    <option value="">No change of method</option>
                    {PAYMENT_METHODS.filter((m) => m !== prefill.paymentMethod).map((m) => <option key={m} value={m}>{METHOD_WORDS[m]}</option>)}
                  </select>
                </label>
                <label htmlFor="svc-last4" className={labelClass}>
                  New account or card, last four digits
                  <input id="svc-last4" inputMode="numeric" autoComplete="off" maxLength={4} className={field} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
                  <span className="text-xs font-normal text-muted-foreground">Only the last four. The full number goes to the carrier, never here.</span>
                </label>
              </>
            )}

            {type === "address_change" && (
              <>
                <label htmlFor="svc-address" className={labelClass}>Street address<input id="svc-address" autoComplete="off" className={field} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label htmlFor="svc-zip" className={labelClass}>ZIP<input id="svc-zip" inputMode="numeric" autoComplete="off" className={field} value={zip} onChange={(e) => setZip(e.target.value)} /></label>
                  <label htmlFor="svc-state" className={labelClass}>State<input id="svc-state" autoComplete="off" maxLength={2} className={field} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} /></label>
                </div>
              </>
            )}

            {fromQueue && (
              <label htmlFor="svc-outcome" className={labelClass}>
                The call
                <select id="svc-outcome" className={field} value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)}>
                  {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{CONTACT_OUTCOME_LABELS[o]}</option>)}
                </select>
              </label>
            )}

            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
              I have sent it to the carrier
            </label>
            {sendNow && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="svc-via" className={labelClass}>
                  How
                  <select id="svc-via" className={field} value={method} onChange={(e) => setMethod(e.target.value as CarrierMethod | "")}>
                    <option value="">Choose…</option>
                    {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
                  </select>
                </label>
                <label htmlFor="svc-ref" className={labelClass}>Their reference<input id="svc-ref" autoComplete="off" className={field} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
                <label htmlFor="svc-form" className={labelClass}>Form used<input id="svc-form" autoComplete="off" className={field} value={formRef} onChange={(e) => setFormRef(e.target.value)} /></label>
                <label htmlFor="svc-effective" className={labelClass}>Takes effect by<input id="svc-effective" type="date" className={field} value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
              </div>
            )}

            <label htmlFor="svc-note" className={labelClass}>Note<textarea id="svc-note" className={`${field} min-h-16 py-2`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {error && <p role="alert" className={alertClass}>{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : sendNow ? "Record as sent" : "Save, send later"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
