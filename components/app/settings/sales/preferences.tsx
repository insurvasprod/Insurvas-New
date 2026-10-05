"use client";

/**
 * Settings › Sales › Quote & QA rules (board l3-set-qa-prefs). Reads and saves the Sales settings
 * document (GET/PUT /api/app/settings/sales/settings); `?preview=sample` reads the defaults.
 *
 * The agency-wide values the pre-submission check (LA-3.11: the per-$1,000 band, the appointment
 * rule), the draft-date optimiser (LA-3.9: the buffer), pending requirements (LA-3.18: ageing) and
 * the welcome pack (LA-3.20: send or hold) read. One draft; Discard / Save changes in the save bar.
 * Owners edit; producers see the values read-only.
 */

import { useState } from "react";
import { notify } from "@/lib/notify";

import { Callout, Field, SettingsCard, SettingsStack, control } from "@/components/app/settings/primitives";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { salesSettingsSchema, type SalesSettings } from "@/lib/salesSettings/schema";
import { cn } from "@/lib/utils";

import { PanelState, useSalesSettings } from "./prefs-settings";
import { CardFact, DiscardSave, ReadOnlyNotice, SalesPanelTop, changedLine } from "./shared";

type Draft = { min: string; max: string; appointmentBlocks: boolean; buffer: 2 | 3 | 4; ageing: string; autoSend: boolean };

const toDraft = (s: SalesSettings): Draft => ({
  min: s.per1000Band.min.toFixed(2), max: s.per1000Band.max.toFixed(2), appointmentBlocks: s.appointmentBlocks,
  buffer: s.draftBufferDays as Draft["buffer"], ageing: String(s.requirementAgeingDays), autoSend: s.welcomePackAutoSend,
});

const num = (text: string) => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : NaN);

function Editor({ saved, canEdit, strip, save }: { saved: SalesSettings; canEdit: boolean; strip: string; save: (next: SalesSettings) => Promise<unknown> }) {
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
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

  const problem = bandError ?? ageingError ?? (valid ? null : "Check the values above.");

  return (
    <>
      {saveError && <Callout tone="error" title={saveError} />}
      {ro && <ReadOnlyNotice what="the quote and QA rules" />}

      <SettingsCard title="Premium plausibility" sub="A premium divided by face amount, in thousands. Anything outside the band is flagged on the case." action={<CardFact>{strip}</CardFact>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lowest per $1,000" htmlFor="qa-band-min" error={bandError ?? undefined} hint="All products. A product with its own band in Carriers and products is checked against that one.">
            <input id="qa-band-min" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.min} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ min: e.target.value })} />
          </Field>
          <Field label="Highest per $1,000" htmlFor="qa-band-max">
            <input id="qa-band-max" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.max} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ max: e.target.value })} />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="What each check does when it fires" sub="Only the appointment check can be set to block. The rest are always warnings.">
        <div className="grid gap-[18px] sm:grid-cols-2">
          <Field label="A carrier we are not appointed with" htmlFor="qa-appointment" hint="Warn lets an agent quote it and sort the appointment out after. Block stops the case at the Quote step.">
            <select id="qa-appointment" className={control} value={draft.appointmentBlocks ? "block" : "warn"} disabled={ro} onChange={(e) => set({ appointmentBlocks: e.target.value === "block" })}>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </select>
          </Field>
          <Field label="Draft-date buffer" htmlFor="qa-buffer" hint="Days after the deposit arrives. Two is the earliest safe day; four suits a bank that holds a deposit overnight.">
            <select id="qa-buffer" className={control} value={draft.buffer} disabled={ro} onChange={(e) => set({ buffer: Number(e.target.value) as Draft["buffer"] })}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </Field>
          <Field label="Requirement ageing, N" htmlFor="qa-ageing" error={ageingError ?? undefined} hint={`Amber at ${ageing} days, red at ${ageing * 2}.`}>
            <input id="qa-ageing" type="number" min={1} max={60} step={1} className={cn(control, "tabular-nums")} value={draft.ageing} disabled={ro} aria-invalid={Boolean(ageingError) || undefined} onChange={(e) => set({ ageing: e.target.value })} />
          </Field>
          <Field label="Welcome pack" htmlFor="qa-welcome" hint={draft.autoSend ? "Sent to the client as soon as the attempt is submitted, once per attempt." : "On hold, the pack waits in the agent's queue and nothing goes out until someone opens it."}>
            <select id="qa-welcome" className={control} value={draft.autoSend ? "auto" : "hold"} disabled={ro} onChange={(e) => set({ autoSend: e.target.value === "auto" })}>
              <option value="auto">Send automatically</option>
              <option value="hold">Hold for review</option>
            </select>
          </Field>
        </div>
      </SettingsCard>

      <SettingsSaveBar visible={canEdit && dirty} note="Unsaved changes to the quote and QA rules">
        <DiscardSave saving={saving} problem={problem} onDiscard={() => { setDraft(toDraft(saved)); setSaveError(null); }} onSave={() => { void onSave(); }} />
      </SettingsSaveBar>
    </>
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
        <Editor key={view.updatedAt ?? "defaults"} saved={view.settings} canEdit={view.canEdit} strip={changedLine(view.updatedAt, view.updatedBy)} save={save} />
      ))}
    </SettingsStack>
  );
}
