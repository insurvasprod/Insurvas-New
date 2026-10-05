"use client";

/**
 * Step ④ — the application record (LA-3.7; board l3-ws-application). Our canonical fields in three
 * groups — Insured, Address and contact, Owner and coverage — whatever the carrier's form calls them.
 * Every input's id is its canonical key, so a QA item lands on it. A carried-in value is drawn warm
 * and says where it came from until it is typed over or confirmed ("Looks right"). The SSN is saved
 * encrypted through its own path and revealed one field at a time; coverage is read from the
 * selected quote and changed only there.
 */

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notify } from "@/lib/notify";

import { control, Field } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { CANONICAL_GROUPS, TIER_LABEL, type CanonicalField } from "@/lib/applications/constants";
import { isPlausibleSsn } from "@/lib/applications/formats";
import type { FieldValue } from "@/lib/applications/types";
import { US_STATES } from "@/lib/appointments/constants";
import { cn } from "@/lib/utils";

import { face, money } from "@/components/app/applications/parts";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { SharedWithPrimary } from "@/components/app/applications/household/shared-detail";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { RevealBox } from "@/components/app/applications/workspace/use-reveal";
import { AutosaveChip, isPrefilled, PREFILL_SURFACE, PrefillHint, ssnMask, ValueBox } from "./step-bits";

const FIELD = new Map<string, CanonicalField>(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));
/**
 * The board's "Effective date". Not a canonical key yet (it needs adding to CANONICAL_GROUPS and to
 * the values route's coverage guard); until it is, the field says so instead of pretending to save.
 */
const EFFECTIVE_DATE_KEY = "cov.effective_date";

const asText = (v: FieldValue["value"] | undefined) => (v === null || v === undefined ? "" : String(v));

function Section({ title, description, children, cols = 3, aside }: { title: string; description?: string; children: ReactNode; cols?: 3 | 4; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] px-[22px] py-[18px] first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ink)]">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>}
        </div>
        {aside}
      </div>
      <div className={cn("grid gap-4 sm:grid-cols-2", cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>{children}</div>
    </div>
  );
}

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
    <Field label={label ?? field?.label ?? fieldKey} htmlFor={fieldKey} required={required}>
      {input}
      <PrefillHint fv={fv} fieldKey={fieldKey} readOnly={readOnly} />
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
  return (
    <Field label="Height / weight" htmlFor="insured.height_in" required={required}>
      <div className="mt-1.5 flex items-center gap-2">
        <input id="insured.height_in" type="number" inputMode="numeric" aria-label="Height in inches" placeholder="in" className={cn(control, "mt-0 min-w-0 flex-1", isPrefilled(h) && PREFILL_SURFACE)} value={asText(h?.value)} disabled={readOnly} onChange={(e) => num("insured.height_in", e.target.value)} />
        <span className="text-sm text-[var(--muted)]">in</span>
        <input id="insured.weight_lb" type="number" inputMode="numeric" aria-label="Weight in pounds" placeholder="lb" className={cn(control, "mt-0 min-w-0 flex-1", isPrefilled(w) && PREFILL_SURFACE)} value={asText(w?.value)} disabled={readOnly} onChange={(e) => num("insured.weight_lb", e.target.value)} />
        <span className="text-sm text-[var(--muted)]">lb</span>
      </div>
      <PrefillHint fv={hint} fieldKey={["insured.height_in", "insured.weight_lb"]} readOnly={readOnly} extra={heightIn ? `${Math.floor(heightIn / 12)}′${heightIn % 12}″` : undefined} />
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
        <button type="button" onClick={() => goTo("quote")} className="mt-1.5 text-[12px] font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
          Choose one on the Quote step
        </button>
      )}
    </Field>
  );
}

export function ApplicationStep() {
  const { attempt, readOnly, setValue, goTo } = useWorkspace();
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

  return (
    <StepCard
      title="Application record"
      chips={<><StatusChip tone="neutral" dot={false}>{fieldSetChip}</StatusChip><AutosaveChip /></>}
      bodyClassName="gap-0 p-0"
      actions={<>
        <Button type="button" variant="outline" onClick={() => goTo("quote")}><ArrowLeft aria-hidden="true" />Back to Quote</Button>
        <Button type="button" onClick={() => goTo("beneficiaries")}>Continue to Beneficiaries<ArrowRight aria-hidden="true" /></Button>
      </>}
    >
      <Section title="Insured">
        <Input fieldKey="insured.first_name" label="Legal first name" required={req("insured.first_name")} />
        <Input fieldKey="insured.last_name" label="Legal last name" required={req("insured.last_name")} />
        <Input fieldKey="insured.dob" required={req("insured.dob")} />
        <Input fieldKey="insured.gender" required={req("insured.gender")} />
        <SsnField required={req("insured.ssn")} />
        <BuildField required={req("insured.height_in") || req("insured.weight_lb")} />
        <Input fieldKey="insured.middle_initial" required={req("insured.middle_initial")} />
        <Input fieldKey="insured.tobacco" required={req("insured.tobacco")} />
        <Input fieldKey="insured.birth_state" required={req("insured.birth_state")} />
      </Section>

      <Section
        title="Address and contact"
        cols={4}
        aside={sharedAddress.length || sharedContact.length ? (
          <span className="flex flex-wrap items-center gap-3">
            {sharedAddress.length > 0 && <span className="flex items-center gap-2 text-xs text-[var(--muted)]">Address <SharedWithPrimary keys={sharedAddress} what="address" /></span>}
            {sharedContact.length > 0 && <span className="flex items-center gap-2 text-xs text-[var(--muted)]">Contact <SharedWithPrimary keys={sharedContact} what="contact details" /></span>}
          </span>
        ) : undefined}
      >
        <Input fieldKey="addr.line1" label="Street" required={req("addr.line1")} />
        <Input fieldKey="addr.city" required={req("addr.city")} />
        <Input fieldKey="addr.state" required={req("addr.state")} />
        <Input fieldKey="addr.zip" required={req("addr.zip")} />
        <Input fieldKey="addr.line2" required={req("addr.line2")} />
        <Input fieldKey="addr.years_at" required={req("addr.years_at")} />
        <Input fieldKey="contact.phone" required={req("contact.phone")} />
        <Input fieldKey="contact.email" required={req("contact.email")} />
      </Section>

      <Section title="Owner and coverage" cols={4}>
        <Field label="Owner" htmlFor="owner.same_as_insured" required={req("owner.same_as_insured")} hint="Change only when the owner is not the insured.">
          <select id="owner.same_as_insured" className={control} value={sameAsInsured ? "same" : "other"} disabled={readOnly} onChange={(e) => setValue("owner.same_as_insured", e.target.value === "same")}>
            <option value="same">Same as insured</option>
            <option value="other">Someone else</option>
          </select>
        </Field>
        <Coverage fieldKey="cov.face_amount" label="Face amount" shown={faceShown} />
        <Coverage fieldKey="cov.monthly_premium" label="Monthly premium" shown={premiumShown ? `${premiumShown}${tierValue ? ` · ${TIER_LABEL[tierValue] ?? tierValue}` : ""}` : ""} />
        {effectiveDateStored ? (
          <Input fieldKey={EFFECTIVE_DATE_KEY} label="Effective date" type="date" required={req(EFFECTIVE_DATE_KEY)} />
        ) : (
          <Field label="Effective date" htmlFor="app.effective_date" hint="Set by the carrier when the policy is issued.">
            <input id="app.effective_date" type="date" className={control} disabled title="The requested effective date is not stored yet — the carrier sets it at issue." />
          </Field>
        )}
        {!sameAsInsured && (
          <>
            <Input fieldKey="owner.first_name" required />
            <Input fieldKey="owner.last_name" required />
            <Input fieldKey="owner.dob" />
            <Input fieldKey="owner.relationship" required />
          </>
        )}
      </Section>
    </StepCard>
  );
}
