"use client";

/**
 * Settings › Sales › Quote & QA rules (round 2026-10-30, board A "one form, by when it acts").
 * Reads and saves the Sales settings document (GET/PUT /api/app/settings/sales/settings);
 * `?preview=sample` reads the defaults.
 *
 * The agency-wide values the pre-submission check (LA-3.11: the per-$1,000 band, the appointment
 * rule), the draft-date optimiser (LA-3.9: the buffer), pending requirements (LA-3.18: ageing) and
 * the welcome pack (LA-3.20: send or hold) read, grouped by the step of a case they act on. Each
 * group shows what the rule does to a case (a quote to try, the draft day it picks, when a
 * requirement turns amber and red) instead of a paragraph. One draft; Discard / Save changes in the
 * save bar. Owners edit; producers see the values read-only. Products with their own band save one
 * at a time from their dialog (product-bands.tsx).
 */

import Link from "next/link";
import { useState } from "react";

import { Callout, Field, SettingsStack, control } from "@/components/app/settings/primitives";
import { FieldDivider, FieldRow, FormSection, FormSections } from "@/components/app/settings/patterns";
import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { premiumPer1000 } from "@/lib/quotes/math";
import { DEFAULT_SALES_SETTINGS, salesSettingsSchema, type SalesSettings } from "@/lib/salesSettings/schema";
import { cn } from "@/lib/utils";

import { PanelState, useSalesSettings } from "./prefs-settings";
import { ProductBands } from "./product-bands";
import { DiscardSave, ReadOnlyNotice, SalesPanelTop, plural } from "./shared";

type Draft = { min: string; max: string; appointmentBlocks: boolean; buffer: 2 | 3 | 4; ageing: string; autoSend: boolean };

const toDraft = (s: SalesSettings): Draft => ({
  min: s.per1000Band.min.toFixed(2), max: s.per1000Band.max.toFixed(2), appointmentBlocks: s.appointmentBlocks,
  buffer: s.draftBufferDays as Draft["buffer"], ageing: String(s.requirementAgeingDays), autoSend: s.welcomePackAutoSend,
});

const DEFAULTS = toDraft(DEFAULT_SALES_SETTINGS);
const LABELS: Record<keyof Draft, string> = { min: "lowest per $1,000", max: "highest per $1,000", appointmentBlocks: "appointment check", buffer: "draft-date buffer", ageing: "requirement ageing", autoSend: "welcome pack" };

const num = (text: string) => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : NaN);
/** "$10,000" / "45.50" → cents, or null while it is not a positive amount. */
const cents = (text: string) => {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function Editor({ saved, canEdit, sample, save, reload }: {
  saved: SalesSettings; canEdit: boolean; sample: boolean; save: (next: SalesSettings) => Promise<unknown>;
  /** Loads the version on the server again (after someone else saved first). */
  reload: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const min = num(draft.min);
  const max = num(draft.max);
  const ageing = Number(draft.ageing);
  const bandError = Number.isNaN(min) || Number.isNaN(max) || min < 0 || max > 100
    ? "Enter both ends as dollar amounts, like 0.50 and 15.00."
    : min >= max ? "The lowest must be below the highest." : null;
  const ageingError = Number.isInteger(ageing) && ageing >= 1 && ageing <= 60 ? null : "Use a whole number of days from 1 to 60.";

  const next: SalesSettings = {
    ...saved,
    per1000Band: { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 },
    appointmentBlocks: draft.appointmentBlocks,
    draftBufferDays: draft.buffer,
    requirementAgeingDays: ageing,
    welcomePackAutoSend: draft.autoSend,
  };
  const valid = !bandError && !ageingError && salesSettingsSchema.safeParse(next).success;
  const original = toDraft(saved);
  const changed = (Object.keys(original) as (keyof Draft)[]).filter((key) => draft[key] !== original[key]);
  const dirty = changed.length > 0;
  const atDefaults = (Object.keys(DEFAULTS) as (keyof Draft)[]).every((key) => draft[key] === DEFAULTS[key]);
  const ro = !canEdit;

  async function onSave() {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(next);
      notify.done("Quote and QA rules saved");
    } catch (e) {
      // What was typed stays on screen.
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const discard = () => { setDraft(original); setSaveError(null); };
  const problem = bandError ?? ageingError ?? (valid ? null : "Check the values above.");
  const band = bandError ? null : { min, max };

  return (
    <FormSections>
      {saveError && (
        <Callout tone="error" title={saveError}>
          {/* The server refuses a save made over a newer one; the way out is to load that version. */}
          <span className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={reload}>Load the latest version</Button>
            <span className="text-sm text-[var(--body)]">Your unsaved changes here are replaced.</span>
          </span>
        </Callout>
      )}
      {ro && <ReadOnlyNotice what="the quote and QA rules" />}

      {/* Two columns from xl (owner 2026-10-30: the whole section in one screen): the quote check and
          product bands on the left, the rules that act later in a case on the right. */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-2 xl:items-start">
      <FormSections className="gap-5">
      <FormSection id="qa-quote" title="Quote check" info="A quote's monthly premium divided by its face amount, in thousands. A quote outside the band gets a warning on the case, so the agent checks the tier and face they typed. It never stops the case. It covers final expense and whole life; a term quote is checked only by its product's own band.">
        <FieldRow>
          <Field label="Lowest per $1,000" htmlFor="qa-band-min" error={bandError ?? undefined} hint={`Insurvas default ${DEFAULTS.min}`}>
            <input id="qa-band-min" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.min} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ min: e.target.value })} />
          </Field>
          <Field label="Highest per $1,000" htmlFor="qa-band-max" hint={`Insurvas default ${DEFAULTS.max}`}>
            <input id="qa-band-max" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.max} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ max: e.target.value })} />
          </Field>
        </FieldRow>
        <FieldDivider />
        <QuoteTester band={band} />
      </FormSection>

      {!sample && <div id="qa-product-bands" className="scroll-mt-24"><ProductBands agencyBand={band} /></div>}

      {canEdit && !atDefaults && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" onClick={() => setDraft(DEFAULTS)}>Use Insurvas defaults</Button>
          <span className="text-xs text-[var(--body)]">0.50–15.00, Warn, 3 days, 5 days, send automatically. Nothing changes until you save.</span>
        </div>
      )}
      </FormSections>

      <FormSections className="gap-5">
      <FormSection
        id="qa-appointment-section" title="Carrier appointment"
        info="An agent can pick any carrier on a quote. This decides what the check does when that carrier has no active appointment in the client's state."
        aside={<Link href="/app/settings#carriers" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">See appointments</Link>}
      >
        <Field label="When the carrier is not appointed in the client's state" hint={draft.appointmentBlocks ? "The case stops at the Quote step until the appointment is active." : undefined}>
          <div id="qa-appointment" className="mt-1.5">
            <Choice label="When the carrier is not appointed" disabled={ro} value={draft.appointmentBlocks ? "block" : "warn"} onChange={(value) => set({ appointmentBlocks: value === "block" })} options={[{ key: "warn", label: "Warn" }, { key: "block", label: "Block" }]} />
          </div>
        </Field>
      </FormSection>

      <FormSection id="qa-payment" title="Payment" info="The draft-day helper on the Payment step aims the first draft this many days after the client's deposit, so the money is there when the carrier pulls it. Four suits a bank that holds a deposit overnight.">
        <Field label="Draft-date buffer after the deposit" hint={`Insurvas default ${DEFAULTS.buffer} days`}>
          <div id="qa-buffer" className="mt-1.5">
            <Choice label="Draft-date buffer" disabled={ro} value={String(draft.buffer)} onChange={(value) => set({ buffer: Number(value) as Draft["buffer"] })} options={[{ key: "2", label: "2 days" }, { key: "3", label: "3 days" }, { key: "4", label: "4 days" }]} />
          </div>
        </Field>
        <BufferExample buffer={draft.buffer} />
      </FormSection>

      <FormSection
        id="qa-after-submit" title="After submit"
        info="What happens once a case is with the carrier: when an open requirement on the Pending page is flagged, and whether the client's welcome pack goes on its own."
        aside={<Link href="/app/pending" className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">See pending cases</Link>}
      >
        {/* Side by side, except in a half-width column where the welcome-pack choice would wrap. */}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Field label="Flag open requirements after (days)" htmlFor="qa-ageing" error={ageingError ?? undefined}>
            <input id="qa-ageing" type="number" min={1} max={60} step={1} className={cn(control, "block max-w-40 tabular-nums")} value={draft.ageing} disabled={ro} aria-invalid={Boolean(ageingError) || undefined} onChange={(e) => set({ ageing: e.target.value })} />
            {!ageingError && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                <StatusChip tone="neutral" dot>Under {plural(ageing, "day")}: on time</StatusChip>
                <StatusChip tone="warning">Day {ageing}: amber</StatusChip>
                <StatusChip tone="danger">Day {ageing * 2}: red</StatusChip>
              </span>
            )}
          </Field>
          <Field label="Welcome pack" hint={draft.autoSend ? undefined : "Waits in the agent's queue; nothing goes out until someone opens and sends it."}>
            <div id="qa-welcome" className="mt-1.5">
              <Choice label="Welcome pack" disabled={ro} value={draft.autoSend ? "auto" : "hold"} onChange={(value) => set({ autoSend: value === "auto" })} options={[{ key: "auto", label: "Send automatically" }, { key: "hold", label: "Hold for review" }]} />
            </div>
          </Field>
        </div>
      </FormSection>
      </FormSections>
      </div>

      <LeaveGuard dirty={canEdit && dirty} onDiscard={discard} what="the quote and QA rules" />
      <SettingsSaveBar visible={canEdit && dirty} note={changed.length === 1 ? `Unsaved change to the ${LABELS[changed[0]]}` : `${changed.length} unsaved changes`}>
        <DiscardSave saving={saving} problem={problem} onDiscard={discard} onSave={() => { void onSave(); }} />
      </SettingsSaveBar>
    </FormSections>
  );
}

type Line = "final_expense" | "whole_life" | "term_life";

/**
 * Type a face amount and a monthly premium; see the per-$1,000 figure and what the check would say.
 * The product type follows qa.ts: term is never judged by the all-products band.
 */
function QuoteTester({ band }: { band: { min: number; max: number } | null }) {
  const [line, setLine] = useState<Line>("final_expense");
  const [face, setFace] = useState("10,000");
  const [premium, setPremium] = useState("45.00");
  const faceCents = cents(face);
  const premiumCents = cents(premium);
  const per = faceCents && premiumCents ? premiumPer1000(premiumCents, faceCents) : null;
  const inside = per !== null && band && line !== "term_life" ? per >= band.min && per <= band.max : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0 text-sm font-semibold text-[var(--ink)]">Try a quote</p>
      <div className="grid min-w-0 items-end gap-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <span className="mb-1.5 block text-label text-[var(--body)]">Product type</span>
          <Segmented label="Product type to try" value={line} onChange={setLine} options={[{ key: "final_expense", label: "Final expense" }, { key: "whole_life", label: "Whole life" }, { key: "term_life", label: "Term" }]} />
        </div>
        <Field label="Face amount" htmlFor="qa-try-face">
          <input id="qa-try-face" inputMode="decimal" className={cn(control, "block tabular-nums")} value={face} onChange={(e) => setFace(e.target.value)} />
        </Field>
        <Field label="Monthly premium" htmlFor="qa-try-premium">
          <input id="qa-try-premium" inputMode="decimal" className={cn(control, "block tabular-nums")} value={premium} onChange={(e) => setPremium(e.target.value)} />
        </Field>
      </div>
      <p className="m-0 flex min-h-9 flex-wrap items-center gap-2 text-sm text-[var(--ink)]" aria-live="polite">
        {per === null ? <span className="text-[var(--body)]">Type a face amount and a premium.</span> : (
          <>
            <span className="font-semibold whitespace-nowrap tabular-nums">${per.toFixed(2)} per $1,000</span>
            {line === "term_life" ? <StatusChip tone="neutral">Term is not checked by this band</StatusChip> : inside === null ? null : inside
              ? <StatusChip tone="good">Inside the band, no warning</StatusChip>
              : <StatusChip tone="warning">Outside the band, agent sees a warning</StatusChip>}
          </>
        )}
      </p>
    </div>
  );
}

/** The draft day the buffer picks for a deposit on the 3rd (a common Social Security date). */
function BufferExample({ buffer }: { buffer: number }) {
  const deposit = 3;
  const days = Array.from({ length: buffer + 1 }, (_, i) => deposit + i);
  return (
    <ol aria-label={`A deposit on the ${ordinal(deposit)} gives a first draft on the ${ordinal(deposit + buffer)}`} className="m-0 flex list-none gap-1 p-0">
      {days.map((day, i) => {
        const first = i === 0;
        const last = i === days.length - 1;
        return (
          <li key={day} className={cn("min-w-0 flex-1 border-t-2 pt-1.5 text-xs transition-colors duration-200", last ? "border-[var(--primary)] font-semibold text-[var(--ink)]" : "border-[var(--border-strong)] text-[var(--muted)]")}>
            {first ? <><span className="block">Deposit</span>{ordinal(day)}</> : last ? <><span className="block">First draft</span>{ordinal(day)}</> : <><span className="block" aria-hidden="true">&nbsp;</span>{ordinal(day)}</>}
          </li>
        );
      })}
    </ol>
  );
}

export function SalesQaPreferences() {
  const { sample, view, state, load, save } = useSalesSettings();
  const blocked = PanelState({ state, onRetry: load, what: "Sales settings" });
  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {blocked ?? (view && (
        // Re-keyed on save so the draft restarts from what the server now holds.
        <Editor key={view.updatedAt ?? "defaults"} saved={view.settings} canEdit={view.canEdit} sample={sample} save={save} reload={() => { void load(); }} />
      ))}
    </SettingsStack>
  );
}

/** A segmented choice, or the chosen label alone when the page is read-only. */
function Choice<K extends string>({ label, value, options, onChange, disabled }: { label: string; value: K; options: ReadonlyArray<{ key: K; label: string }>; onChange: (key: K) => void; disabled?: boolean }) {
  if (disabled) return <span className="text-sm text-[var(--body)]">{options.find((option) => option.key === value)?.label ?? value}</span>;
  return <Segmented label={label} value={value} onChange={onChange} options={options} />;
}
