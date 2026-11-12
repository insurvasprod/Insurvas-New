"use client";

/**
 * Settings › Sales process › Quote & case checks (was Quote & QA rules). Reads and saves the Sales settings
 * document (GET/PUT /api/app/settings/sales/settings); `?preview=sample` reads the defaults.
 *
 * The agency-wide values the pre-submission check (LA-3.11: the per-$1,000 band, the appointment rule), the
 * draft-date optimiser (LA-3.9: the buffer), pending requirements (LA-3.18: ageing) and the welcome pack (LA-3.20:
 * send or hold) read. Settings round 8 (owner pick A, sales-process board "4 · Quote & case checks", 2026-11-12):
 * two cards split by when each check runs — on the Quote step, and at Review and after submit — a status line
 * under the title, Save on the title's line (the page's one way to save) and Try a quote in a dialog. Products
 * with their own band are records, each changed in its own dialog (product-bands.tsx).
 *
 * The board's third appointment choice (Allow) is not in the stored settings, so the choice stays Block or Warn.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { DefaultChip, ResetToDefault } from "@/components/app/settings/defaults";
import { Field, SettingsSectionHeader, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { premiumPer1000 } from "@/lib/quotes/math";
import { agoText } from "@/lib/salesSettings/salesProcess";
import { DEFAULT_SALES_SETTINGS, salesSettingsSchema, type SalesSettings } from "@/lib/salesSettings/schema";
import { cn } from "@/lib/utils";

import { Pane, StatusLine, TabBody, TabFrame, ThreeWay } from "../sales-process/parts";
import { useSalesSettings, type LoadState } from "./prefs-settings";
import { ProductBands } from "./product-bands";
import { SalesPanelTop } from "./shared";

type Draft = { min: string; max: string; appointmentBlocks: boolean; buffer: 2 | 3 | 4; ageing: string; autoSend: boolean };

const toDraft = (s: SalesSettings): Draft => ({
  min: s.per1000Band.min.toFixed(2), max: s.per1000Band.max.toFixed(2), appointmentBlocks: s.appointmentBlocks,
  buffer: s.draftBufferDays as Draft["buffer"], ageing: String(s.requirementAgeingDays), autoSend: s.welcomePackAutoSend,
});

const DEFAULTS = toDraft(DEFAULT_SALES_SETTINGS);
/** The keys this page owns, at their Insurvas defaults (Reset leaves the welcome pack wording and AI alone). */
const DEFAULT_RULES = {
  per1000Band: DEFAULT_SALES_SETTINGS.per1000Band,
  appointmentBlocks: DEFAULT_SALES_SETTINGS.appointmentBlocks,
  draftBufferDays: DEFAULT_SALES_SETTINGS.draftBufferDays,
  requirementAgeingDays: DEFAULT_SALES_SETTINGS.requirementAgeingDays,
  welcomePackAutoSend: DEFAULT_SALES_SETTINGS.welcomePackAutoSend,
} satisfies Partial<SalesSettings>;
const LABELS: Record<keyof Draft, string> = { min: "lowest per $1,000", max: "highest per $1,000", appointmentBlocks: "appointment check", buffer: "draft-date buffer", ageing: "requirement ageing", autoSend: "welcome pack" };

const num = (text: string) => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : NaN);
/** "$10,000" / "45.50" → cents, or null while it is not a positive amount. */
const cents = (text: string) => {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

function Editor({ saved, canEdit, sample, save, reload, updatedAt, updatedBy }: {
  saved: SalesSettings; canEdit: boolean; sample: boolean; save: (next: SalesSettings) => Promise<unknown>;
  /** Loads the version on the server again (after someone else saved first). */
  reload: () => void;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
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
  const savedAtDefaults = (Object.keys(DEFAULTS) as (keyof Draft)[]).every((key) => original[key] === DEFAULTS[key]);
  const ro = !canEdit;

  async function onSave() {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(next);
      notify.done("Quote and case checks saved");
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
  const changedText = changed.length === 1 ? `Unsaved change to the ${LABELS[changed[0]]}` : `${changed.length} unsaved changes`;

  return (
    <>
      <SettingsSectionHeader
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setTrying(true)}>Try a quote</Button>
            {canEdit && dirty && <Button type="button" variant="ghost" disabled={saving} onClick={discard}>Discard</Button>}
            {canEdit && (
              <Button type="button" disabled={!dirty || saving || Boolean(problem)} title={dirty && problem ? problem : undefined} onClick={() => { void onSave(); }}>{saving ? "Saving…" : "Save"}</Button>
            )}
          </>
        }
      />
      {saveError ? (
        <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={reload}>Load the latest version</Button>}>Couldn&apos;t save: {saveError} Your changes are still here.</StatusLine>
      ) : dirty ? (
        <StatusLine tone="warn">{changedText}{problem ? ` · ${problem}` : ""}</StatusLine>
      ) : (
        <StatusLine tone={ro ? "muted" : "ok"}>
          {updatedAt ? "Saved" : "Insurvas defaults"} · these apply to every carrier and product{updatedAt ? ` · changed${updatedBy ? ` by ${updatedBy}` : ""}, ${agoText(updatedAt)}` : ""}{ro ? " · read only: only an owner changes them" : ""}
        </StatusLine>
      )}

      <TabBody>
        <div className="flex min-h-0 min-w-0 flex-col gap-3 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
          <Pane title="On the Quote step" sub="step 4" className="lg:shrink-0">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1">
                <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">Monthly price per $1,000 of cover</h4>
                <p className="m-0 text-xs text-[var(--muted)]">Outside the band, the agent sees a warning before choosing the quote. It never stops the case. Final expense and whole life; a term quote is checked only by its product&apos;s own band.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lowest per $1,000" htmlFor="qa-band-min" error={bandError ?? undefined} info={`Insurvas default ${DEFAULTS.min}`}>
                  <input id="qa-band-min" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.min} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ min: e.target.value })} />
                </Field>
                <Field label="Highest per $1,000" htmlFor="qa-band-max" info={`Insurvas default ${DEFAULTS.max}`}>
                  <input id="qa-band-max" type="number" min={0} max={100} step="0.01" inputMode="decimal" className={cn(control, "tabular-nums")} value={draft.max} disabled={ro} aria-invalid={Boolean(bandError) || undefined} onChange={(e) => set({ max: e.target.value })} />
                </Field>
              </div>
              {band && <BandBar band={band} />}
              {/* Insurvas defaults (docs/settings/DEFAULTS.md): marked while every check is the default; otherwise the way back. */}
              {savedAtDefaults ? (atDefaults && (
                <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]"><DefaultChip label="All Insurvas defaults" />0.50–15.00, Warn, 3 days, 5 days, send automatically.</span>
              )) : canEdit && (
                <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                  <ResetToDefault
                    what="the quote and case checks"
                    kept="The welcome pack wording and the AI assistant switch are not touched."
                    disabled={saving || sample}
                    onReset={async () => {
                      try {
                        await save({ ...saved, ...DEFAULT_RULES });
                        setDraft(DEFAULTS);
                        notify.done("Quote and case checks are back on the Insurvas defaults");
                        return true;
                      } catch (e) {
                        notify.block(e instanceof Error ? e.message : "That didn't save. Try again.");
                        return false;
                      }
                    }}
                  />
                  0.50–15.00, Warn, 3 days, 5 days, send automatically.
                </span>
              )}
            </div>
          </Pane>
          {!sample && <div id="qa-product-bands" className="min-w-0 scroll-mt-24"><ProductBands agencyBand={band} /></div>}
        </div>

        <Pane title="At Review and after submit" sub="steps 9 · 10 · after" className="lg:flex-1">
          <div className="flex flex-col">
            <CheckRow title="When the carrier is not appointed in the client's state" help={<>Checked at Review against your appointments. {draft.appointmentBlocks ? "Block stops the case at the Quote step until the appointment is active." : "Warn lets the case go on with a warning."} <Link href="/app/settings#carriers" className="font-semibold text-[var(--accent-ink)] hover:underline">See appointments</Link></>}>
              <span id="qa-appointment"><ThreeWay label="When the carrier is not appointed" disabled={ro} value={draft.appointmentBlocks ? "block" : "warn"} onChange={(value) => set({ appointmentBlocks: value === "block" })} options={[{ key: "block", label: "Block" }, { key: "warn", label: "Warn" }]} /></span>
            </CheckRow>
            <CheckRow title="Draft-date buffer after the deposit" help={<>First draft at least this many days after the client&apos;s deposit, so the money is there when the carrier pulls it. Four suits a bank that holds a deposit overnight.<BufferExample buffer={draft.buffer} /></>}>
              <span id="qa-buffer"><ThreeWay label="Draft-date buffer" disabled={ro} value={String(draft.buffer)} onChange={(value) => set({ buffer: Number(value) as Draft["buffer"] })} options={[{ key: "2", label: "2 days" }, { key: "3", label: "3 days" }, { key: "4", label: "4 days" }]} /></span>
            </CheckRow>
            <CheckRow title="Flag open requirements after" help={<>{ageingError ?? `A carrier requirement older than this shows amber on Pending, red on day ${ageing * 2}.`} <Link href="/app/pending" className="font-semibold text-[var(--accent-ink)] hover:underline">See pending cases</Link></>}>
              <span className="flex items-center gap-2">
                <input id="qa-ageing" aria-label="Flag open requirements after, in days" type="number" min={1} max={60} step={1} className={cn(control, "mt-0 w-20 tabular-nums")} value={draft.ageing} disabled={ro} aria-invalid={Boolean(ageingError) || undefined} onChange={(e) => set({ ageing: e.target.value })} />
                <span className="text-sm text-[var(--body)]">days</span>
              </span>
            </CheckRow>
            <CheckRow title="Welcome pack" help={draft.autoSend ? "Goes to the client on its own once the case is submitted." : "Waits in the agent's queue; nothing goes out until someone opens and sends it."}>
              <span id="qa-welcome"><ThreeWay label="Welcome pack" disabled={ro} value={draft.autoSend ? "auto" : "hold"} onChange={(value) => set({ autoSend: value === "auto" })} options={[{ key: "auto", label: "Send" }, { key: "hold", label: "Hold for review" }]} /></span>
            </CheckRow>
            <CheckRow title="Missing Required fields from the carrier application" help="Always blocks Submit. Set the fields in Carrier application.">
              <span className="text-sm text-[var(--muted)]">Always on</span>
            </CheckRow>
          </div>
        </Pane>
      </TabBody>

      <LeaveGuard dirty={canEdit && dirty} onDiscard={discard} what="the quote and case checks" />

      <Dialog open={trying} onOpenChange={setTrying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Try a quote</DialogTitle>
            <DialogDescription>Type a face amount and a premium. Nothing is saved.</DialogDescription>
          </DialogHeader>
          <QuoteTester band={band} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => setTrying(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One check: what it is and what it does, its choice on the right. */
function CheckRow({ title, help, children }: { title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1 basis-56">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">{title}</p>
        <div className="text-xs leading-[1.5] text-[var(--muted)]">{help}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** The band on a $0–$20 line, so a typo (150 for 1.50) shows at once. */
function BandBar({ band }: { band: { min: number; max: number } }) {
  const scale = Math.max(20, Math.ceil(band.max / 5) * 5);
  const left = Math.min(100, (band.min / scale) * 100);
  const width = Math.max(1, Math.min(100 - left, ((band.max - band.min) / scale) * 100));
  return (
    <div aria-hidden="true" className="flex flex-col gap-1">
      <div className="relative h-2 rounded-full bg-[var(--surface-alt)]">
        <div className="absolute inset-y-0 rounded-full bg-[var(--primary)]" style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-[var(--muted)]"><span>$0</span><span>${band.min.toFixed(2)} – ${band.max.toFixed(2)}</span><span>${scale}</span></div>
    </div>
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
            <span className="font-semibold whitespace-nowrap tabular-nums">${per.toFixed(2)} per $1,000 a month</span>
            {line === "term_life" ? <StatusChip tone="neutral">Term is not checked by this band</StatusChip> : inside === null ? null : inside
              ? <StatusChip tone="good">Inside the band</StatusChip>
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
    <ol aria-label={`A deposit on the ${ordinal(deposit)} gives a first draft on the ${ordinal(deposit + buffer)}`} className="m-0 mt-2 flex max-w-xs list-none gap-1 p-0">
      {days.map((day, i) => {
        const first = i === 0;
        const last = i === days.length - 1;
        return (
          <li key={day} className={cn("min-w-0 flex-1 border-t-2 pt-1 text-xs transition-colors duration-200", last ? "border-[var(--primary)] font-semibold text-[var(--ink)]" : "border-[var(--border-strong)] text-[var(--muted)]")}>
            {first ? <><span className="block">Deposit</span>{ordinal(day)}</> : last ? <><span className="block">First draft</span>{ordinal(day)}</> : <><span className="block" aria-hidden="true">&nbsp;</span>{ordinal(day)}</>}
          </li>
        );
      })}
    </ol>
  );
}

export function SalesQaPreferences() {
  const { sample, view, state, load, save } = useSalesSettings();
  return (
    <TabFrame>
      <SalesPanelTop sample={sample} />
      <Blocked state={state} onRetry={() => { void load(); }} />
      {!state.loading && !state.pending && !state.error && view && (
        // Re-keyed on save so the draft restarts from what the server now holds.
        <Editor key={view.updatedAt ?? "defaults"} saved={view.settings} canEdit={view.canEdit} sample={sample} save={save} reload={() => { void load(); }} updatedAt={view.updatedAt} updatedBy={view.updatedBy} />
      )}
    </TabFrame>
  );
}

/** Loading, needing a database update, or failed: the status line says which (round 8: never a notice card). */
function Blocked({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  if (state.loading) return <StatusLine tone="muted">Reading your checks</StatusLine>;
  if (state.pending) return <StatusLine tone="warn">Quote and case checks need a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>;
  if (state.error) return <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>}>{state.error}</StatusLine>;
  return null;
}
