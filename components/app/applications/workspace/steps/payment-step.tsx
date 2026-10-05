"use client";

/**
 * Payment step (LA-3.19 payment record, LA-3.9 draft date; board l3-ws-payment). Two cards: how the
 * premium is paid, and the draft date.
 *
 * Sensitive numbers are validated as typed, sent once, and cleared from the screen; a stored number
 * shows masked with Reveal (one audit row per reveal), and a replacement left blank keeps the stored
 * one. The routing checksum runs for ACH only, Luhn for cards, the Mastercard check for Direct
 * Express (a warning — it still saves). There is no card security code anywhere — we never ask.
 *
 * The form saves itself when the agent leaves a field (and when the step goes away), except a method
 * switch that would clear stored bank or card numbers: that waits for "Continue", which saves
 * whatever is on screen first. The draft day saves once a method that drafts is on file.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, PenLine } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type IncomeType, type PaymentMethod } from "@/lib/applications/constants";
import { cardBrand, cardExpiryInFuture, digitsOnly, isValidAbaRouting, isValidBankAccount, maskLast4, passesLuhn, type CardBrand } from "@/lib/applications/formats";
import type { PaymentView } from "@/lib/applications/types";
import type { PayFrequency } from "@/lib/draftDates/optimiser";
import { cn } from "@/lib/utils";

import { DraftDatePanel, inputFromInitial, type DraftDateCommit, type DraftDateInitial } from "@/components/app/applications/draft-dates/draft-date-panel";
import { useDraftBuffer } from "@/components/app/applications/draft-dates/use-draft-buffer";
import { useWorkspace, type PaymentSave } from "@/components/app/applications/workspace/context";
import { SaveStatus } from "@/components/app/applications/workspace/save-status";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { SharedWithPrimary } from "@/components/app/applications/household/shared-detail";
import { useReveal } from "@/components/app/applications/workspace/use-reveal";

const METHOD_SHORT: Record<PaymentMethod, string> = { ach: "ACH", direct_express: "Direct Express", debit_card: "Debit card", credit_card: "Credit card", direct_bill: "Direct bill" };
const BRAND_LABEL: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard", discover: "Discover", amex: "American Express" };
const CARD_METHODS: PaymentMethod[] = ["direct_express", "debit_card", "credit_card"];
const BILLING_FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Every six months" },
  { value: "annual", label: "Yearly" },
] as const;
const DRAFT_DELAY = 500;

type BillingFrequency = NonNullable<PaymentView["billingFrequency"]>;
const isCardMethod = (m: PaymentMethod | null | undefined) => Boolean(m && CARD_METHODS.includes(m));

/** What is on screen. The three numbers hold only what the agent typed now; "" keeps what is stored. */
type Form = {
  method: PaymentMethod | null;
  routing: string;
  account: string;
  accountType: "checking" | "savings" | null;
  bankName: string;
  nameOnAccount: string;
  card: string;
  expMonth: number | null;
  expYear: number | null;
  nameOnCard: string;
  billingFrequency: BillingFrequency | null;
  billingSame: boolean;
};

function formFrom(pay: PaymentView | null): Form {
  return {
    method: pay?.method ?? null,
    routing: "", account: "", card: "",
    accountType: pay?.accountType ?? null,
    bankName: pay?.bankName ?? "",
    nameOnAccount: pay?.nameOnAccount ?? "",
    expMonth: pay?.card?.expMonth ?? null,
    expYear: pay?.card?.expYear ?? null,
    nameOnCard: pay?.nameOnCard ?? "",
    billingFrequency: pay?.billingFrequency ?? null,
    // PaymentView does not carry the stored flag; the insured's address is the default.
    billingSame: true,
  };
}

/** The non-secret fields the server keeps, for "is there anything unsaved". */
const settled = (f: Form) => JSON.stringify([f.method, f.accountType, f.bankName.trim(), f.nameOnAccount.trim(), f.expMonth, f.expYear, f.nameOnCard.trim(), f.billingFrequency]);

/** Does saving `next` clear numbers the stored method holds? (ACH ↔ card; card ↔ card keeps the card.) */
function clearsStored(stored: PaymentView | null, next: PaymentMethod) {
  if (!stored || stored.method === next) return null;
  if (stored.method === "ach" && (stored.routing?.hasValue || stored.account?.hasValue)) return "bank numbers";
  if (isCardMethod(stored.method) && !isCardMethod(next) && stored.card?.hasValue) return "card number";
  return null;
}

/**
 * One sensitive number: an input for a new value; the stored value's mask in the placeholder; Reveal
 * for the stored value (shown for a minute, one audit row). Validation shows once the agent leaves
 * the field or tries to continue.
 */
function NumberField({ id, label, fieldKey, stored, value, onChange, onLeave, error, hint, readOnly }: {
  id: string;
  label: string;
  fieldKey: string;
  stored: { masked: string; hasValue: boolean } | undefined;
  value: string;
  onChange: (v: string) => void;
  /** The agent left the field: show what is wrong with it now. */
  onLeave: () => void;
  error: string | null;
  hint?: ReactNode;
  readOnly: boolean;
}) {
  const { value: revealed, busy, reveal, hide } = useReveal(fieldKey, stored?.masked);
  const has = Boolean(stored?.hasValue);
  const revealButton = has && (revealed !== null ? (
    <Button type="button" variant="ghost" onClick={hide} aria-label={`Hide ${label.toLowerCase()}`}><EyeOff aria-hidden="true" />Hide</Button>
  ) : (
    <Button type="button" variant="ghost" onClick={() => { void reveal(); }} disabled={busy} title={busy ? "Revealing…" : undefined} aria-label={`Reveal the stored ${label.toLowerCase()}`}><Eye aria-hidden="true" />Reveal</Button>
  ));
  const shownHint = hint ?? (revealed !== null ? "Masked again in a minute." : has ? `${readOnly ? "" : `Leave blank to keep ${stored!.masked}. `}One field per reveal. Each one writes an audit row.` : undefined);

  if (readOnly) {
    return (
      <Field label={label} htmlFor={id} hint={shownHint}>
        <span id={id} tabIndex={-1} className="mt-1.5 flex h-9 items-center gap-2 outline-none">
          <span className="font-mono text-sm tabular-nums text-[var(--ink)]">{revealed ?? (has ? stored!.masked : "Not given")}</span>
          {revealButton}
        </span>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id} required={!has} error={error} hint={shownHint}>
      <span className="flex items-center gap-2">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={revealed ?? (has ? stored!.masked : undefined)}
          aria-invalid={Boolean(error)}
          className={cn(control, "font-mono tabular-nums")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (value.trim()) onLeave(); }}
        />
        {revealButton && <span className="mt-1.5">{revealButton}</span>}
      </span>
    </Field>
  );
}

function PaymentStepFor() {
  const { attempt, interview, readOnly: closed, sample, updateAttempt, actions, goTo } = useWorkspace();
  const stored = attempt.payment;
  // LA-3.24 · on the spouse's application a shared payment method and draft day follow the primary
  // insured's until they are detached, so neither can be edited here while shared.
  const paymentShared = attempt.insuredRole === "spouse" && Boolean(stored?.linked);
  const draftShared = attempt.insuredRole === "spouse" && Boolean(stored?.draftDayLinked);
  const readOnly = closed || paymentShared;
  const [form, setForm] = useState<Form>(() => formFrom(stored));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [thisYear] = useState(() => new Date().getUTCFullYear());
  const [draftTouched, setDraftTouched] = useState(false);
  const [draftHeld, setDraftHeld] = useState(false);
  const draftQueued = useRef<DraftDateCommit | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSent = useRef<string>(JSON.stringify([stored?.draftDay ?? null, stored?.incomeType ?? null, stored?.incomeInputs ?? {}, stored?.draftOverrideReason ?? null]));

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const method = form.method;
  const accepted = attempt.product?.acceptedPaymentMethods ?? [];
  const notAccepted = method && accepted.length > 0 && !accepted.includes(method);
  const isCard = isCardMethod(method);
  const keepFor = (m: PaymentMethod[]) => (stored && m.includes(stored.method) ? stored : null);
  const storedRouting = keepFor(["ach"])?.routing;
  const storedAccount = keepFor(["ach"])?.account;
  const storedCardFor = keepFor(CARD_METHODS)?.card;
  const expExpired = form.expMonth && form.expYear ? !cardExpiryInFuture(form.expMonth, form.expYear) : false;
  const dob = attempt.values["insured.dob"]?.value;
  const gender = attempt.values["insured.gender"]?.value;
  const pronoun = gender === "female" ? "her" : gender === "male" ? "him" : "them";
  const depositAnswer = interview?.answers.ss_deposit_day?.value;

  // ── validation: as typed, shown once the agent has left the field or pressed Continue ──
  const routingBad = form.routing.trim() !== "" && !isValidAbaRouting(form.routing);
  // Nine digits typed is a whole routing number: say so then, not only once the agent tabs away —
  // otherwise the card reads "Not saved" with nothing marked in red.
  const routingWhole = digitsOnly(form.routing).length >= 9;
  const accountBad = form.account.trim() !== "" && !isValidBankAccount(form.account);
  const cardBad = form.card.trim() !== "" && !passesLuhn(form.card);
  const typedBrand = digitsOnly(form.card).length >= 4 ? cardBrand(form.card) : null;
  const deBrand = form.card.trim() ? typedBrand : storedCardFor?.brand ?? null;
  const deNotMastercard = method === "direct_express" && Boolean(form.card.trim() ? digitsOnly(form.card).length >= 4 : storedCardFor?.hasValue) && deBrand !== "mastercard";
  const invalid = (method === "ach" && (routingBad || accountBad)) || (isCard && (cardBad || expExpired));
  const typedAny = Boolean(form.routing.trim() || form.account.trim() || form.card.trim());
  const dirty = typedAny || settled(form) !== settled(formFrom(stored)) || (method === "direct_bill" && !form.billingSame);
  const wouldClear = method ? clearsStored(stored, method) : null;

  // The latest screen, for saves fired from blur and unmount (the workspace hands out new
  // functions on every render; a save must not be re-sent because one of them changed).
  const latest = useRef({ form, dirty, invalid, wouldClear, busy, stored, updateAttempt, actions });
  useEffect(() => { latest.current = { form, dirty, invalid, wouldClear, busy, stored, updateAttempt, actions }; });
  const inFlight = useRef<Promise<boolean> | null>(null);

  // ── draft day: saved once a method that drafts is on file ────────────────
  const storedDrafts = Boolean(stored && stored.method !== "direct_bill");

  const sendDraft = useCallback((c: DraftDateCommit) => {
    const key = JSON.stringify([c.draftDay, c.incomeType, c.incomeInputs, c.draftOverrideReason]);
    if (key === draftSent.current) return;
    draftSent.current = key;
    setDraftTouched(true);
    void actions.saveDraftDay({ day: c.draftDay, incomeType: c.incomeType, incomeInputs: c.incomeInputs, overrideReason: c.draftOverrideReason })
      .then((ok) => { if (!ok) draftSent.current = ""; });
  }, [actions]);

  const flushDraft = useCallback((canSave: boolean) => {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    const c = draftQueued.current;
    if (!c) return;
    // A day off the recommendation waits for its recorded reason (the server refuses it without one).
    if (c.draftDay !== null && c.draftDayRecommended !== null && c.draftDay !== c.draftDayRecommended && !c.draftOverrideReason) return;
    if (!canSave) { setDraftHeld(true); return; }
    draftQueued.current = null;
    setDraftHeld(false);
    sendDraft(c);
  }, [sendDraft]);

  function commitDraft(c: DraftDateCommit) {
    if (sample) {
      const base: PaymentView = stored ?? { method: method ?? "ach", draftDay: null, draftDayRecommended: null, draftOverrideReason: null, incomeType: null, incomeInputs: {} };
      updateAttempt({ payment: { ...base, incomeType: c.incomeType, incomeInputs: c.incomeInputs, draftDay: c.draftDay, draftDayRecommended: c.draftDayRecommended, draftOverrideReason: c.draftOverrideReason } });
    }
    draftQueued.current = c;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => flushDraft(storedDrafts || sample), DRAFT_DELAY);
  }

  // ── payment details ──────────────────────────────────────────────────────
  function savePayment(f: Form): Promise<boolean> {
    const run = doSave(f);
    inFlight.current = run;
    void run.finally(() => { if (inFlight.current === run) inFlight.current = null; });
    return run;
  }

  async function doSave(f: Form): Promise<boolean> {
    const { stored, updateAttempt, actions } = latest.current;
    const m = f.method;
    if (!m) return false;
    const card = isCardMethod(m);
    const input: PaymentSave = { method: m };
    if (m === "ach") {
      Object.assign(input, {
        routing: f.routing.trim() || null, account: f.account.trim() || null, account_type: f.accountType,
        bank_name: f.bankName.trim() || null, name_on_account: f.nameOnAccount.trim() || null,
      });
    } else if (card) {
      Object.assign(input, { card: f.card.trim() || null, card_exp_month: f.expMonth, card_exp_year: f.expYear, name_on_card: f.nameOnCard.trim() || null });
    } else {
      Object.assign(input, { billing_frequency: f.billingFrequency ?? "monthly", billing_address_same_as_insured: f.billingSame });
    }
    setBusy(true);
    setTouched(true);
    try {
      if (!(await actions.savePayment(input))) return false; // the typed numbers stay on screen; the workspace says why
      if (sample) {
        const masked = (raw: string, prev: { masked: string; hasValue: boolean } | undefined) => (raw.trim() ? { masked: maskLast4(raw), hasValue: true } : prev);
        const keep = stored?.method === m ? stored : null;
        const keepCard = isCardMethod(stored?.method) ? stored?.card : undefined;
        updateAttempt({
          payment: {
            method: m, draftDay: m === "direct_bill" ? null : stored?.draftDay ?? null, draftDayRecommended: stored?.draftDayRecommended ?? null,
            draftOverrideReason: stored?.draftOverrideReason ?? null, incomeType: stored?.incomeType ?? null, incomeInputs: stored?.incomeInputs ?? {},
            accountType: f.accountType, bankName: f.bankName, nameOnAccount: f.nameOnAccount,
            routing: m === "ach" ? masked(f.routing, keep?.routing) : undefined,
            account: m === "ach" ? masked(f.account, keep?.account) : undefined,
            card: card ? {
              ...(f.card.trim() ? { masked: maskLast4(f.card), hasValue: true, brand: cardBrand(f.card) } : { masked: keepCard?.masked ?? "", hasValue: keepCard?.hasValue ?? false, brand: keepCard?.brand ?? null }),
              expMonth: f.expMonth, expYear: f.expYear,
            } : undefined,
            nameOnCard: f.nameOnCard, billingFrequency: m === "direct_bill" ? f.billingFrequency ?? "monthly" : null,
          },
        });
      }
      // Never keep a full number on screen after it is saved.
      setForm((cur) => ({ ...cur, routing: cur.routing === f.routing ? "" : cur.routing, account: cur.account === f.account ? "" : cur.account, card: cur.card === f.card ? "" : cur.card }));
      setChecked(false);
      // A draft day chosen before a method was on file goes now.
      if (m !== "direct_bill") flushDraft(true);
      return true;
    } finally {
      setBusy(false);
    }
  }

  /** Save what is on screen when it is complete, valid, and clears nothing stored. */
  function autosave() {
    const l = latest.current;
    if (readOnly || l.busy || inFlight.current || !l.dirty || !l.form.method) return;
    if (l.invalid) { setChecked(true); return; }
    if (l.wouldClear) return;
    void savePayment(l.form);
  }

  // Leaving the step: send what is safe to send, and the draft day with it (or keep holding it).
  const onLeave = useRef<() => void>(() => {});
  useEffect(() => { onLeave.current = () => { autosave(); flushDraft(storedDrafts || sample); }; });
  useEffect(() => { const leave = onLeave; return () => leave.current(); }, []);

  async function continueToDisclosures() {
    // A save the blur already started covers what was on screen.
    if (inFlight.current) {
      if (!(await inFlight.current)) return;
      goTo("disclosures");
      return;
    }
    if (!readOnly && dirty && method) {
      setChecked(true);
      if (invalid) { notify.block("Fix the payment details first", { detail: "The field with the problem says what is wrong." }); return; }
      if (!(await savePayment(form))) return;
    }
    goTo("disclosures");
  }

  const pickMethod = (m: PaymentMethod) => {
    if (m === method) return;
    // Switching clears the fields the old method needed, and nothing else.
    set({ method: m, routing: "", account: "", card: "" });
    setChecked(false);
  };

  const inputs = stored?.incomeInputs ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const draftInitial: DraftDateInitial = {
    incomeType: (stored?.incomeType ?? null) as IncomeType | null,
    birthDay: num(inputs.birthDay),
    before1997: inputs.before1997 === true,
    pensionDay: num(inputs.pensionDay),
    payFrequency: text(inputs.payFrequency) as PayFrequency | null,
    payAnchor: text(inputs.payAnchor),
    draftDay: stored?.draftDay ?? null,
    overrideReason: stored?.draftOverrideReason ?? null,
  };
  const dobText = typeof dob === "string" ? dob : null;
  const buffer = useDraftBuffer({ enabled: !sample, inferFrom: { input: inputFromInitial(draftInitial, dobText), recommended: stored?.draftDayRecommended ?? null } });
  const cardStoredLabel = storedCardFor ? { masked: storedCardFor.brand ? `${BRAND_LABEL[storedCardFor.brand as CardBrand] ?? storedCardFor.brand} ${storedCardFor.masked}` : storedCardFor.masked, hasValue: storedCardFor.hasValue } : undefined;

  // The one line under the fields: which checksum ran, and what it said. A failure or a Direct
  // Express brand mismatch is an alert the agent acts on; a pass is a quiet one-line confirmation.
  const passed = (text: string) => <p role="status" className="flex items-center gap-2 text-sm text-[var(--success-ink)]"><Check className="size-4" aria-hidden="true" />{text}</p>;
  let check: ReactNode = null;
  if (method === "ach") {
    // A failing checksum shows once the agent has left the field; a passing one as soon as it passes.
    if (form.routing.trim() && (!routingBad || checked || routingWhole)) check = routingBad ? <Callout tone="error" title="Routing checksum fails — read the 9 digits back to the client." /> : passed("Routing checksum passes");
    else if (storedRouting?.hasValue) check = passed("Routing checksum passed when it was saved");
  } else if (isCard) {
    if (deNotMastercard && form.card.trim() && (!cardBad || !checked)) {
      check = <Callout tone="warning" title={`${typedBrand ? `This looks like a ${BRAND_LABEL[typedBrand]}; ` : ""}Direct Express cards are Mastercard. Check the number with the client — it still saves.`} />;
    } else if (form.card.trim() && (!cardBad || checked)) {
      check = cardBad
        ? <Callout tone="error" title="Card number fails its checksum — read it back to the client." />
        : passed(`Card checksum passes${typedBrand ? ` · ${BRAND_LABEL[typedBrand]}` : ""}`);
    } else if (storedCardFor?.hasValue) {
      check = deNotMastercard
        ? <Callout tone="warning" title="The stored card is not a Mastercard, and Direct Express cards are. Check the number with the client." />
        : passed("Card checksum passed when it was saved");
    }
  }

  let pendingNote: string | null = null;
  if (!readOnly && dirty && method) {
    if (invalid && checked) pendingNote = "Not saved — fix the field marked in red.";
    else if (wouldClear) pendingNote = `Not saved yet — switching clears the stored ${wouldClear}. Continue saves it.`;
  }
  if (draftHeld && !pendingNote) pendingNote = "The draft day saves once the payment method is saved.";

  return (
    <div className="flex flex-col items-stretch gap-5 2xl:flex-row 2xl:items-start">
      <StepCard
        title="How the premium is paid"
        className="min-w-0 flex-1"
        chips={<>
          {!readOnly && <SaveStatus touched={touched} pendingNote={pendingNote} className="max-w-[280px]" />}
          <StatusChip tone="neutral">CVV is never stored</StatusChip>
          {paymentShared && <SharedWithPrimary keys={["payment"]} what="payment method" />}
        </>}
        actions={<>
          <Button type="button" variant="outline" onClick={() => goTo("beneficiaries")}><ArrowLeft aria-hidden="true" />Back to Beneficiaries</Button>
          <Button type="button" onClick={() => { void continueToDisclosures(); }} disabled={busy} title={busy ? "Saving the payment details…" : undefined}>Continue to Disclosures<ArrowRight aria-hidden="true" /></Button>
        </>}
      >
        {/* Leaving a field saves what is on screen. */}
        <div className="flex flex-col gap-[18px]" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) autosave(); }}>
          <div className="flex flex-col gap-2">
            <div id="pay.method" tabIndex={-1} role="radiogroup" aria-label="How the premium is paid" className="inline-flex w-fit max-w-full flex-wrap gap-[3px] rounded-[8px] bg-[var(--surface-alt)] p-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {PAYMENT_METHODS.map((m) => {
                const on = method === m;
                const refused = accepted.length > 0 && !accepted.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly}
                    title={closed ? "This attempt is closed" : paymentShared ? "Shared with the primary insured — detach it to change it here." : refused ? `${attempt.carrierName ?? "This carrier"} does not list ${PAYMENT_METHOD_LABEL[m].toLowerCase()}` : PAYMENT_METHOD_LABEL[m]}
                    onClick={() => pickMethod(m)}
                    className={cn(
                      "h-[30px] rounded-[6px] border px-3.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                      on ? "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent bg-transparent text-[var(--muted)] hover:text-[var(--ink)]",
                    )}
                  >
                    {METHOD_SHORT[m]}
                  </button>
                );
              })}
            </div>
            {!method && <p className="text-sm text-[var(--muted)]">Choose how they&apos;ll pay.</p>}
            {notAccepted && <p className="text-xs text-[var(--warning-ink)]">{attempt.carrierName ?? "This carrier"} does not list {PAYMENT_METHOD_LABEL[method].toLowerCase()} — check the carrier&apos;s rules before submitting.</p>}
          </div>

          {method === "ach" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name" htmlFor="pay.bank_name">
                <input id="pay.bank_name" className={control} autoComplete="off" value={form.bankName} disabled={readOnly} onChange={(e) => set({ bankName: e.target.value })} />
              </Field>
              <NumberField
                id="pay.routing_number" label="Routing number" fieldKey="pay.routing_number" stored={storedRouting}
                value={form.routing} onChange={(v) => set({ routing: v })} onLeave={() => setChecked(true)} readOnly={readOnly}
                error={(checked || routingWhole) && routingBad ? "That is not a valid 9-digit routing number." : null}
              />
              <NumberField
                id="pay.account_number" label="Account number" fieldKey="pay.account_number" stored={storedAccount}
                value={form.account} onChange={(v) => set({ account: v })} onLeave={() => setChecked(true)} readOnly={readOnly}
                error={checked && accountBad ? "Account numbers are 4 to 17 digits." : null}
              />
              <Field label="Account type" htmlFor="pay.account_type" required>
                <select id="pay.account_type" className={control} value={form.accountType ?? ""} disabled={readOnly} onChange={(e) => set({ accountType: (e.target.value || null) as Form["accountType"] })}>
                  <option value="">Choose</option>
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                </select>
              </Field>
              <Field label="Name on the account" htmlFor="pay.name_on_account">
                <input id="pay.name_on_account" className={control} autoComplete="off" value={form.nameOnAccount} disabled={readOnly} onChange={(e) => set({ nameOnAccount: e.target.value })} />
              </Field>
            </div>
          )}

          {isCard && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                id="pay.card_number" label="Card number" fieldKey="pay.card_number" stored={cardStoredLabel}
                value={form.card} onChange={(v) => set({ card: v })} onLeave={() => setChecked(true)} readOnly={readOnly}
                error={checked && cardBad ? "That card number doesn't check out — read it back to the client." : null}
                hint={typedBrand && !cardBad ? `Looks like a ${BRAND_LABEL[typedBrand]} — confirm with the client.` : undefined}
              />
              <Field label="Expires" htmlFor="pay.card_exp" required error={expExpired ? "This card has expired." : null}>
                <span className="flex gap-2">
                  <select id="pay.card_exp" aria-label="Expiry month" className={cn(control, "tabular-nums")} value={form.expMonth ?? ""} disabled={readOnly} onChange={(e) => set({ expMonth: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Month</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => <option key={mo} value={mo}>{String(mo).padStart(2, "0")}</option>)}
                  </select>
                  <select id="pay.card_exp_year" aria-label="Expiry year" className={cn(control, "tabular-nums")} value={form.expYear ?? ""} disabled={readOnly} onChange={(e) => set({ expYear: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Year</option>
                    {Array.from({ length: 11 }, (_, i) => thisYear + i).map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </span>
              </Field>
              <Field label="Name on the card" htmlFor="pay.name_on_card">
                <input id="pay.name_on_card" className={control} autoComplete="off" value={form.nameOnCard} disabled={readOnly} onChange={(e) => set({ nameOnCard: e.target.value })} />
              </Field>
            </div>
          )}

          {method === "direct_bill" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Billing frequency" htmlFor="pay.billing_frequency" required>
                <select id="pay.billing_frequency" className={control} value={form.billingFrequency ?? ""} disabled={readOnly} onChange={(e) => set({ billingFrequency: (e.target.value || null) as BillingFrequency | null })}>
                  <option value="">Choose</option>
                  {BILLING_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              <label htmlFor="pay.billing_same" className="flex min-h-9 items-center gap-2 self-end text-sm text-[var(--body)]">
                <input id="pay.billing_same" type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.billingSame} disabled={readOnly} onChange={(e) => set({ billingSame: e.target.checked })} />
                Bill the insured&apos;s address
              </label>
              {!form.billingSame && <p className="text-xs text-[var(--muted)] sm:col-span-2">Enter the billing address on the carrier&apos;s form — it is not stored here.</p>}
            </div>
          )}

          {check}
          {closed && stored && <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><PenLine className="size-3.5" aria-hidden="true" />This attempt is closed; its payment details are kept as they were.</p>}
        </div>
      </StepCard>

      {method === "direct_bill" ? (
        <StepCard title="Draft date" chips={<StatusChip tone="neutral">Not drafted</StatusChip>} className="w-full shrink-0 2xl:w-[320px]">
          <p id="pay.draft_day" tabIndex={-1} className="text-sm text-[var(--muted)] outline-none">Direct bill isn&apos;t drafted, so there&apos;s no draft day to choose. The carrier bills the client.</p>
        </StepCard>
      ) : (
        <DraftDatePanel
          className="w-full shrink-0 2xl:w-[320px]"
          idPrefix="pay.dd"
          draftDayId="pay.draft_day"
          dob={dobText}
          buffer={buffer}
          readOnly={closed || draftShared}
          pronoun={pronoun}
          incomeHint={typeof depositAnswer === "string" ? `They said: ${depositAnswer}.` : null}
          initial={draftInitial}
          onCommit={commitDraft}
          status={draftShared ? <SharedWithPrimary keys={["draft_day"]} what="draft day" /> : !closed && draftTouched ? <SaveStatus touched={draftTouched} /> : undefined}
        />
      )}
    </div>
  );
}

export function PaymentStep() {
  const { attempt } = useWorkspace();
  return <PaymentStepFor key={attempt.id} />;
}
