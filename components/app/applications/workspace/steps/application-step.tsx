"use client";

/**
 * Step ④ — the application record (LA-3.7; board l3-ws-application). Our canonical fields in three
 * groups — Insured, Address and contact, Owner and coverage — whatever the carrier's form calls them.
 * Every input's id is its canonical key, so a QA item lands on it. A carried-in value is drawn warm
 * and says where it came from until it is typed over or confirmed ("Looks right"). The SSN is saved
 * encrypted through its own path and revealed one field at a time; coverage is read from the
 * selected quote and changed only there.
 *
 * Owner 2026-10-28: drawn like Verify and the interview — each group a section that folds to
 * "Complete" once its required fields are filled and nothing carried in is left unchecked, two fields
 * to a line (FoldSection), and one "They all look right" for every value carried in from the call.
 */

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { notify } from "@/lib/notify";

import { control, Field } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { CANONICAL_GROUPS, TIER_LABEL, type CanonicalField } from "@/lib/applications/constants";
import { isPlausibleSsn } from "@/lib/applications/formats";
import { orderedKeys } from "@/lib/applications/fieldSetLayout";
import type { FieldValue } from "@/lib/applications/types";
import { US_STATES } from "@/lib/appointments/constants";
import { cn } from "@/lib/utils";

import { face, money } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { SharedWithPrimary } from "@/components/app/applications/household/shared-detail";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";
import { RevealBox } from "@/components/app/applications/workspace/use-reveal";
import { AutosaveChip, hasContent, isPrefilled, PREFILL_SURFACE, PrefillHint, ssnMask, ValueBox } from "./step-bits";

const FIELD = new Map<string, CanonicalField>(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));
/**
 * The board's "Effective date". Not a canonical key yet (it needs adding to CANONICAL_GROUPS and to
 * the values route's coverage guard); until it is, the field says so instead of pretending to save.
 */
const EFFECTIVE_DATE_KEY = "cov.effective_date";

const asText = (v: FieldValue["value"] | undefined) => (v === null || v === undefined ? "" : String(v));

/** One canonical input: warm while carried in, typed-over values become the agent's own. */
function Input({ fieldKey, label, required, type }: { fieldKey: string; label?: string; required?: boolean; type?: "text" | "date" | "number" | "tel" | "email" | "state" | "select" }) {
  const { attempt, readOnly: closed, setValue } = useWorkspace();
  const field = FIELD.get(fieldKey);
  const fv = attempt.values[fieldKey];
  // LA-3.24 · a spouse's shared detail follows the primary's until it is detached (the section says so).
  const shared = attempt.insuredRole === "spouse" && Boolean(fv?.linked);
  const readOnly = closed || shared;
  const kind = type ?? (field?.input as typeof type) ?? "text";
  const warm = isPrefilled(fv) ? PREFILL_SURFACE : "";
  const value = fv?.value;
  let input: ReactNode;
  if (kind === "select" || kind === "state") {
    const options = kind === "state" ? US_STATES.map(([code, name]) => ({ value: code, label: name })) : field?.options ?? [];
    input = (
      <select id={fieldKey} className={cn(control, warm)} value={asText(value)} disabled={readOnly} title={shared ? "Shared with the primary insured — detach it to change it here." : undefined} onChange={(e) => setValue(fieldKey, e.target.value || null)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else {
    const numeric = kind === "number";
    input = (
      <input
        id={fieldKey}
        type={kind}
        inputMode={numeric || fieldKey === "addr.zip" ? "numeric" : undefined}
        maxLength={fieldKey === "insured.middle_initial" ? 1 : undefined}
        autoComplete="off"
        className={cn(control, warm)}
        value={asText(value)}
        disabled={readOnly}
        title={shared ? "Shared with the primary insured — detach it to change it here." : undefined}
        onChange={(e) => setValue(fieldKey, e.target.value === "" ? null : numeric ? Number(e.target.value) : e.target.value)}
      />
    );
  }
  return (
    <Field label={label ?? field?.label ?? fieldKey} htmlFor={fieldKey} required={required} hint={setHint(attempt, fieldKey)}>
      {input}
      <PrefillHint fv={fv} fieldKey={fieldKey} readOnly={readOnly} />
    </Field>
  );
}

/** The field set's line under a field (owner 2026-10-30): what the carrier's form calls it, and its help. */
function setHint(attempt: ReturnType<typeof useWorkspace>["attempt"], fieldKey: string) {
  const wording = attempt.fieldSet?.wording[fieldKey];
  const help = attempt.fieldSet?.help[fieldKey];
  const parts = [wording ? `On the ${attempt.carrierName ?? "carrier's"} form: \u201c${wording}\u201d` : null, help ?? null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** One of the agency's own questions (custom.*), drawn by its type; saved like any field. */
function QuestionInput({ q }: { q: NonNullable<ReturnType<typeof useWorkspace>["attempt"]["fieldSet"]>["custom"][number] }) {
  const { attempt, readOnly, setValue } = useWorkspace();
  const fv = attempt.values[q.key];
  const value = asText(fv?.value);
  const set = (v: string) => setValue(q.key, v === "" ? null : q.type === "number" || q.type === "currency" ? Number(v) : v);
  let input: ReactNode;
  if (q.type === "choice" || q.type === "yes_no" || q.type === "state") {
    const options = q.type === "yes_no" ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
      : q.type === "state" ? US_STATES.map(([code, name]) => ({ value: code, label: name }))
        : q.options.map((o) => ({ value: o, label: o }));
    input = (
      <select id={q.key} className={control} value={value} disabled={readOnly} onChange={(e) => set(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (q.type === "long_text") {
    input = <textarea id={q.key} className={cn(control, "min-h-20 py-2")} value={value} disabled={readOnly} onChange={(e) => set(e.target.value)} />;
  } else {
    const kind = q.type === "phone" ? "tel" : q.type === "currency" ? "number" : q.type === "date" || q.type === "number" || q.type === "email" ? q.type : "text";
    input = <input id={q.key} type={kind} inputMode={kind === "number" ? "decimal" : undefined} autoComplete="off" className={control} value={value} disabled={readOnly} onChange={(e) => set(e.target.value)} />;
  }
  return (
    <Field label={q.label} htmlFor={q.key} required={q.required} hint={q.help || undefined}>
      {input}
    </Field>
  );
}

function SsnField({ required }: { required: boolean }) {
  const { attempt, sample, actions, readOnly } = useWorkspace();
  const fv = attempt.values["insured.ssn"];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasValue = Boolean(fv?.hasValue);

  const open = () => { setEditing(true); requestAnimationFrame(() => document.getElementById("insured.ssn")?.focus()); };
  const cancel = () => { setEditing(false); setDraft(""); setError(null); };
  const apply = async () => {
    const value = draft.trim();
    if (!isPlausibleSsn(value)) { setError("That is not a valid Social Security number. Check the nine digits."); return; }
    setBusy(true);
    try {
      // A failed save keeps the typed number in the input (the workspace says why); a saved one is
      // cleared at once — only the last four come back from the server.
      if (!(await actions.saveSsn(value))) return;
      notify.done(sample ? "Sample data — the number passed the check and was not stored." : "Social Security number saved");
      cancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="Social Security number" htmlFor="insured.ssn" required={required} error={error}>
      {editing ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="insured.ssn"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="123-45-6789"
            aria-invalid={Boolean(error)}
            className={cn(control, "mt-0 min-w-0 flex-1 font-mono")}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (!busy) void apply(); }
              if (e.key === "Escape") cancel();
            }}
          />
          <Button type="button" variant="outline" onClick={cancel} disabled={busy} title={busy ? "Saving" : undefined}>Cancel</Button>
          <Button type="button" onClick={() => { void apply(); }} disabled={busy} title={busy ? "Saving" : undefined}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <RevealBox id={hasValue ? "insured.ssn" : undefined} fieldKey="insured.ssn" masked={fv?.masked} display={ssnMask(fv?.masked)} hasValue={hasValue} label="Social Security number" />
          </div>
          {!readOnly && <Button id={hasValue ? undefined : "insured.ssn"} type="button" variant="outline" className="mt-1.5" onClick={open}>{hasValue ? "Change" : "Add"}</Button>}
        </div>
      )}
      {!editing && <PrefillHint fv={fv} fieldKey="insured.ssn" readOnly={readOnly} extra={hasValue ? "One field per reveal. Each one writes an audit row." : undefined} />}
    </Field>
  );
}

/** Height and weight in one cell, as the board draws them. */
function BuildField({ required }: { required: boolean }) {
  const { attempt, readOnly, setValue } = useWorkspace();
  const h = attempt.values["insured.height_in"];
  const w = attempt.values["insured.weight_lb"];
  const num = (key: string, v: string) => setValue(key, v === "" ? null : Number(v));
  const hint = isPrefilled(h) ? h : isPrefilled(w) ? w : undefined;
  const heightIn = typeof h?.value === "number" ? h.value : null;
  // Feet and inches, as people say a height (owner 2026-10-29: one box for total inches read like
  // centimetres). Stored as total inches, as before. A box being typed in keeps its text until the
  // other is filled, so "5" then "8" never jumps.
  const [feetText, setFeetText] = useState(() => (heightIn === null ? "" : String(Math.floor(heightIn / 12))));
  const [inchText, setInchText] = useState(() => (heightIn === null ? "" : String(heightIn % 12)));
  function setHeight(feet: string, inches: string) {
    setFeetText(feet); setInchText(inches);
    const f = feet === "" ? null : Number(feet);
    const i = inches === "" ? 0 : Number(inches);
    num("insured.height_in", f === null || !Number.isFinite(f) || !Number.isFinite(i) ? "" : String(f * 12 + i));
  }
  const box = (prefilled: boolean) => cn(control, "mt-0 w-16 min-w-0 text-right", prefilled && PREFILL_SURFACE);
  const unit = "text-sm text-[var(--muted)]";
  return (
    <Field label="Height / weight" htmlFor="insured.height_ft" required={required}>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input id="insured.height_ft" type="number" inputMode="numeric" min={3} max={8} aria-label="Height, feet" placeholder="5" className={box(isPrefilled(h))} value={feetText} disabled={readOnly} onChange={(e) => setHeight(e.target.value, inchText)} />
        <span className={unit}>ft</span>
        <input id="insured.height_in" type="number" inputMode="numeric" min={0} max={11} aria-label="Height, inches" placeholder="8" className={box(isPrefilled(h))} value={inchText} disabled={readOnly} onChange={(e) => setHeight(feetText, e.target.value)} />
        <span className={unit}>in</span>
        <input id="insured.weight_lb" type="number" inputMode="numeric" aria-label="Weight in pounds" placeholder="180" className={cn(control, "mt-0 w-24 min-w-0 text-right", isPrefilled(w) && PREFILL_SURFACE)} value={asText(w?.value)} disabled={readOnly} onChange={(e) => num("insured.weight_lb", e.target.value)} />
        <span className={unit}>lb</span>
      </div>
      <PrefillHint fv={hint} fieldKey={["insured.height_in", "insured.weight_lb"]} readOnly={readOnly} />
    </Field>
  );
}

/** Coverage, read from the selected quote. `id` is the canonical key QA links to. */
function Coverage({ fieldKey, label, shown }: { fieldKey: string; label: string; shown: string }) {
  const { attempt, readOnly, goTo } = useWorkspace();
  const fv = attempt.values[fieldKey];
  return (
    <Field label={label} htmlFor={fieldKey}>
      <ValueBox id={fieldKey} prefilled={Boolean(shown)}>{shown || <span className="text-[var(--muted)]">No quote selected</span>}</ValueBox>
      {shown ? (
        <PrefillHint fv={fv} fieldKey={fieldKey} readOnly />
      ) : !readOnly && (
        <button type="button" onClick={() => goTo("quote")} className="mt-1.5 text-xs font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
          Choose one on the Quote step
        </button>
      )}
    </Field>
  );
}

export function ApplicationStep() {
  const { attempt, readOnly, setValue, goTo, markReviewed } = useWorkspace();
  const values = attempt.values;
  const required = new Set(attempt.requiredKeys);
  const req = (key: string) => required.has(key);
  const sameAsInsured = values["owner.same_as_insured"]?.value !== false;
  const effectiveDateStored = FIELD.has(EFFECTIVE_DATE_KEY);

  const selected = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  const faceShown = typeof values["cov.face_amount"]?.value === "number" ? face(values["cov.face_amount"]!.value as number) : selected ? face(selected.faceAmountCents) : "";
  const premiumShown = typeof values["cov.monthly_premium"]?.value === "number" ? money(values["cov.monthly_premium"]!.value as number) : selected ? money(selected.monthlyPremiumCents) : "";
  const tierValue = asText(values["cov.product_tier"]?.value) || selected?.tier || "";

  // The view says which fields are required, not which set supplied them (a carrier without its own set uses the platform default).
  const fieldSetChip = `${attempt.carrierName ?? "Final Expense default"} · ${attempt.requiredKeys.length} required`;
  // LA-3.24 · the spouse's address and contact details that still follow the primary insured's.
  const linkedKeys = (prefix: string) => attempt.insuredRole === "spouse" ? Object.keys(values).filter((k) => k.startsWith(prefix) && values[k]?.linked) : [];
  const sharedAddress = linkedKeys("addr.");
  const sharedContact = linkedKeys("contact.");

  // Each section's fields, for its count and whether it can fold.
  const groupKeys = {
    insured: ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in", "insured.weight_lb", "insured.middle_initial", "insured.tobacco", "insured.birth_state"],
    address: ["addr.line1", "addr.city", "addr.state", "addr.zip", "addr.line2", "addr.years_at", "contact.phone", "contact.email"],
    owner: ["owner.same_as_insured", "cov.face_amount", "cov.monthly_premium", ...(sameAsInsured ? [] : ["owner.first_name", "owner.last_name", "owner.dob", "owner.relationship"])],
  };
  const filled = (key: string) => hasContent(values[key]) || (key === "owner.same_as_insured");
  const unchecked = (key: string) => isPrefilled(values[key]) && !values[key]!.reviewed;
  const progress = (keys: string[]) => {
    const needed = keys.filter((k) => req(k) || (!sameAsInsured && ["owner.first_name", "owner.last_name", "owner.relationship"].includes(k)));
    const done = needed.filter(filled).length;
    return { done, total: needed.length, complete: done === needed.length && !keys.some(unchecked) && keys.some((k) => hasContent(values[k])) };
  };
  const pInsured = progress(groupKeys.insured);
  const pAddress = progress(groupKeys.address);
  const pOwner = progress(groupKeys.owner);
  const toCheck = [...groupKeys.insured, ...groupKeys.address, ...groupKeys.owner].filter(unchecked);
  // The field set's order for the Insured and Address sections (owner 2026-10-30); a field it does not
  // ask is left out. Height and weight share one cell, placed where the first of them comes.
  const layout = attempt.fieldSet;
  const insuredNode: Record<string, ReactNode> = {
    "insured.first_name": <Input key="insured.first_name" fieldKey="insured.first_name" label="Legal first name" required={req("insured.first_name")} />,
    "insured.last_name": <Input key="insured.last_name" fieldKey="insured.last_name" label="Legal last name" required={req("insured.last_name")} />,
    "insured.middle_initial": <Input key="insured.middle_initial" fieldKey="insured.middle_initial" required={req("insured.middle_initial")} />,
    "insured.dob": <Input key="insured.dob" fieldKey="insured.dob" required={req("insured.dob")} />,
    "insured.gender": <Input key="insured.gender" fieldKey="insured.gender" required={req("insured.gender")} />,
    "insured.birth_state": <Input key="insured.birth_state" fieldKey="insured.birth_state" required={req("insured.birth_state")} />,
    "insured.ssn": <SsnField key="insured.ssn" required={req("insured.ssn")} />,
    "insured.tobacco": <Input key="insured.tobacco" fieldKey="insured.tobacco" required={req("insured.tobacco")} />,
    "insured.height_in": <BuildField key="build" required={req("insured.height_in") || req("insured.weight_lb")} />,
  };
  // The agency's own questions sit in their section (Insured, Address and contact) at their place in the
  // set's order; those for owner, coverage or payment come together under "<carrier> questions".
  const custom = layout?.custom ?? [];
  const customIn = (groups: string[]) => custom.filter((q) => groups.includes(q.group));
  for (const q of custom) insuredNode[q.key] = <QuestionInput key={q.key} q={q} />;
  const insuredOrder = [...new Set(orderedKeys(layout, [...groupKeys.insured, ...customIn(["insured"]).map((q) => q.key)]).map((k) => (k === "insured.weight_lb" ? "insured.height_in" : k)))];
  const addressNode: Record<string, ReactNode> = {
    "addr.line1": <Input key="addr.line1" fieldKey="addr.line1" label="Street" required={req("addr.line1")} />,
    "addr.line2": <Input key="addr.line2" fieldKey="addr.line2" required={req("addr.line2")} />,
    "addr.city": <Input key="addr.city" fieldKey="addr.city" required={req("addr.city")} />,
    "addr.state": <Input key="addr.state" fieldKey="addr.state" required={req("addr.state")} />,
    "addr.zip": <Input key="addr.zip" fieldKey="addr.zip" required={req("addr.zip")} />,
    "addr.years_at": <Input key="addr.years_at" fieldKey="addr.years_at" required={req("addr.years_at")} />,
    "contact.phone": <Input key="contact.phone" fieldKey="contact.phone" required={req("contact.phone")} />,
    "contact.email": <Input key="contact.email" fieldKey="contact.email" required={req("contact.email")} />,
  };
  for (const q of custom) addressNode[q.key] = <QuestionInput key={q.key} q={q} />;
  const addressOrder = orderedKeys(layout, [...groupKeys.address, ...customIn(["addr", "contact"]).map((q) => q.key)]);
  const questions = customIn(["owner", "cov", "pay"]);
  const questionsDone = questions.filter((q) => q.required && hasContent(values[q.key])).length;
  const questionsRequired = questions.filter((q) => q.required).length;

  return (
    <section aria-label="Application record" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip tone="neutral" dot={false}>{fieldSetChip}</StatusChip>
          <AutosaveChip />
        </span>
        {!readOnly && toCheck.length > 0 && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
            {toCheck.length} value{toCheck.length === 1 ? "" : "s"} from the call still to check
            <Button type="button" size="sm" variant="outline" className="border-[color-mix(in_srgb,var(--primary)_55%,transparent)] text-[var(--accent-ink)]" onClick={() => { for (const k of toCheck) markReviewed(k); }}>
              <Check aria-hidden="true" />They all look right
            </Button>
          </span>
        )}
      </div>

      <FoldSection heading="Insured" done={pInsured.done} total={pInsured.total} complete={pInsured.complete} unit="required filled">
        {insuredOrder.map((k) => insuredNode[k])}
      </FoldSection>

      <FoldSection heading="Address and contact" done={pAddress.done} total={pAddress.total} complete={pAddress.complete} unit="required filled">
        {(sharedAddress.length > 0 || sharedContact.length > 0) && (
          <span className="flex flex-wrap items-center gap-3 px-1">
            {sharedAddress.length > 0 && <span className="flex items-center gap-2 text-xs text-[var(--muted)]">Address <SharedWithPrimary keys={sharedAddress} what="address" /></span>}
            {sharedContact.length > 0 && <span className="flex items-center gap-2 text-xs text-[var(--muted)]">Contact <SharedWithPrimary keys={sharedContact} what="contact details" /></span>}
          </span>
        )}
        {addressOrder.map((k) => addressNode[k])}
      </FoldSection>

      <FoldSection heading="Owner and coverage" done={pOwner.done} total={pOwner.total} complete={pOwner.complete} unit="required filled">
        <Field label="Owner" htmlFor="owner.same_as_insured" required={req("owner.same_as_insured")} hint="Change only when the owner is not the insured.">
          <select id="owner.same_as_insured" className={control} value={sameAsInsured ? "same" : "other"} disabled={readOnly} onChange={(e) => setValue("owner.same_as_insured", e.target.value === "same")}>
            <option value="same">Same as insured</option>
            <option value="other">Someone else</option>
          </select>
        </Field>
        {effectiveDateStored ? (
          <Input fieldKey={EFFECTIVE_DATE_KEY} label="Effective date" type="date" required={req(EFFECTIVE_DATE_KEY)} />
        ) : (
          <Field label="Effective date" htmlFor="app.effective_date" hint="Set by the carrier when the policy is issued.">
            <input id="app.effective_date" type="date" className={control} disabled title="The requested effective date is not stored yet — the carrier sets it at issue." />
          </Field>
        )}
        <Coverage fieldKey="cov.face_amount" label="Face amount" shown={faceShown} />
        <Coverage fieldKey="cov.monthly_premium" label="Monthly premium" shown={premiumShown ? `${premiumShown}${tierValue ? ` · ${TIER_LABEL[tierValue] ?? tierValue}` : ""}` : ""} />
        {!sameAsInsured && <Input fieldKey="owner.first_name" required />}
        {!sameAsInsured && <Input fieldKey="owner.last_name" required />}
        {!sameAsInsured && <Input fieldKey="owner.dob" />}
        {!sameAsInsured && <Input fieldKey="owner.relationship" required />}
      </FoldSection>

      {questions.length > 0 && (
        <FoldSection heading={`${attempt.carrierName ?? "Carrier"} questions`} done={questionsDone} total={questionsRequired} complete={questionsDone === questionsRequired && questions.some((q) => hasContent(values[q.key]))} unit="required filled">
          {questions.map((q) => <QuestionInput key={q.key} q={q} />)}
        </FoldSection>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border)] pt-3">
        <Button type="button" variant="outline" onClick={() => goTo("quote")}><ArrowLeft aria-hidden="true" />Back to Quote</Button>
        <Button type="button" onClick={() => goTo("beneficiaries")}>Continue to Beneficiaries<ArrowRight aria-hidden="true" /></Button>
      </div>
    </section>
  );
}
