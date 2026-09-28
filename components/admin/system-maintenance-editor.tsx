"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btn, Callout, control, Field, SettingsCard, type Tone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  MAINTENANCE_LEVEL_LABELS,
  type EffectiveMaintenanceLevel,
  type MaintenanceRow,
  type MaintenanceStatus,
} from "@/lib/system/constants";
import {
  confirmsLock,
  fromUtcInput,
  LOCK_CONFIRM_PHRASE,
  MAINTENANCE_REASON_MAX,
  MAINTENANCE_REASON_MIN,
  maintenanceDraftError,
  toUtcInput,
  utcDateTime,
} from "@/lib/system/adminFormat";

type Draft = { level: EffectiveMaintenanceLevel; message: string; start: string; end: string };

const LEVEL_LABEL: Record<EffectiveMaintenanceLevel, string> = { off: "Off", ...MAINTENANCE_LEVEL_LABELS };

const LEVEL_CARDS: { value: EffectiveMaintenanceLevel; title: string; body: ReactNode }[] = [
  { value: "off", title: "Off", body: "Normal operation. Nothing is shown to customers." },
  {
    value: "banner_only",
    title: "Banner only",
    body: "Customers see the message at the top of every page. Reading and saving carry on as normal.",
  },
  {
    value: "read_only",
    title: "Read only",
    body: (
      <>
        Writes are refused with <code className="font-mono text-[12px]">maintenance_read_only</code> (503). Reading continues
        everywhere.
      </>
    ),
  },
  {
    value: "locked",
    title: "Locked",
    body: "The agent shell redirects every customer to /maintenance and sign-in is refused until it is turned off. Staff are not affected.",
  },
];

/** What the confirmation says will happen, by the level being saved. */
const EFFECT: Record<EffectiveMaintenanceLevel, { tone: Tone; title: string; body: string }> = {
  off: {
    tone: "success",
    title: "Customers get full access back straight away",
    body: "The banner stops, saving works again and nobody is sent to /maintenance.",
  },
  banner_only: {
    tone: "warning",
    title: "Every customer sees this message",
    body: "It appears at the top of every page in the app. Nothing is blocked.",
  },
  read_only: {
    tone: "error",
    title: "Every save in the product is refused",
    body: "Customers can still sign in and read, but anything that writes answers maintenance_read_only (503) until this ends.",
  },
  locked: {
    tone: "error",
    title: "Every customer is shut out of the product",
    body: "The app sends every customer to /maintenance and sign-in is refused until it is turned off or the scheduled end passes. Staff sessions are not affected.",
  },
};

const PREVIEW_TITLE: Record<"banner_only" | "read_only", string> = {
  banner_only: "Scheduled maintenance",
  read_only: "Platform is read-only",
};

function baselineFrom(stored: MaintenanceRow | null, status: MaintenanceStatus): Draft {
  // A window that has already ended leaves its row behind but is off for customers; start from
  // what is true, keeping the old message to save retyping it.
  if (!stored || status.level === "off") return { level: "off", message: stored?.message ?? "", start: "", end: "" };
  return {
    level: stored.level,
    message: stored.message,
    start: toUtcInput(stored.scheduled_start),
    end: toUtcInput(stored.scheduled_end),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.level !== b.level) return false;
  if (a.level === "off") return true;
  return a.message.trim() === b.message.trim() && a.start === b.start && a.end === b.end;
}

export function SystemMaintenanceEditor({
  stored,
  status,
  nowIso,
  canChange,
}: {
  stored: MaintenanceRow | null;
  status: MaintenanceStatus;
  nowIso: string;
  canChange: boolean;
}) {
  const router = useRouter();
  const [baseline] = useState<Draft>(() => baselineFrom(stored, status));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [formError, setFormError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = !sameDraft(draft, baseline);
  const off = draft.level === "off";
  // The route asks for the phrase whenever the saved level is locked, including edits while locked.
  const needsLockPhrase = draft.level === "locked";
  const reasonOk = reason.trim().length >= MAINTENANCE_REASON_MIN && reason.trim().length <= MAINTENANCE_REASON_MAX;
  const phraseOk = !needsLockPhrase || confirmsLock(phrase);

  const startIso = off ? null : fromUtcInput(draft.start);
  const endIso = off ? null : fromUtcInput(draft.end);
  const futureStart = startIso && new Date(startIso).getTime() > Date.parse(nowIso) ? startIso : null;

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError(null);
  }

  function review() {
    const problem = maintenanceDraftError(draft, Date.now());
    if (problem) return setFormError(problem);
    setReason("");
    setPhrase("");
    setSaveError(null);
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reasonOk || !phraseOk) return;
    setSaving(true);
    setSaveError(null);
    const response = await fetch("/api/admin/system/maintenance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: draft.level,
        message: off ? "" : draft.message.trim(),
        scheduled_start: off ? null : fromUtcInput(draft.start),
        scheduled_end: off ? null : fromUtcInput(draft.end),
        reason: reason.trim(),
        ...(needsLockPhrase ? { confirmPhrase: phrase } : {}),
      }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setSaveError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    setOpen(false);
    notify.done(off ? "Maintenance turned off" : `Maintenance set to ${LEVEL_LABEL[draft.level].toLowerCase()}`);
    router.refresh();
  }

  const levelChanged = draft.level !== baseline.level;
  const dialogTitle = !levelChanged
    ? "Update maintenance"
    : { off: "Turn maintenance off", banner_only: "Show a maintenance banner", read_only: "Make the platform read only", locked: "Lock the platform" }[draft.level];
  const effect = EFFECT[draft.level];
  const danger = draft.level === "locked" || draft.level === "read_only";

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* ── Level ───────────────────────────────────────────────────────── */}
      <SettingsCard title="Level">
        <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0" disabled={!canChange}>
          <legend className="sr-only">Maintenance level</legend>
          {LEVEL_CARDS.map((card) => {
            const selected = draft.level === card.value;
            return (
              <label
                key={card.value}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[8px] px-4 py-3.5 text-left has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring-color)]",
                  selected
                    ? "border-[1.5px] border-[var(--primary)] bg-[var(--brand-50)]"
                    : "border border-[var(--border-strong)] bg-[var(--surface)]",
                  canChange ? "cursor-pointer" : "cursor-not-allowed opacity-80",
                )}
              >
                <input
                  type="radio"
                  name="maintenance-level"
                  value={card.value}
                  checked={selected}
                  onChange={() => update({ level: card.value })}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-[18px] shrink-0 rounded-full",
                    selected ? "border-[5px] border-[var(--primary)] bg-[var(--surface)]" : "border-[1.5px] border-[var(--border-strong)]",
                  )}
                />
                <span>
                  <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{card.title}</span>
                  <span className="mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{card.body}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <Field label="Customer-visible message" htmlFor="maintenance-message">
            <textarea
              id="maintenance-message"
              rows={3}
              maxLength={1000}
              value={draft.message}
              disabled={!canChange || off}
              onChange={(event) => update({ message: event.target.value })}
              className={cn(control, "h-auto px-3 py-2.5")}
            />
          </Field>
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Scheduled end (UTC)" htmlFor="maintenance-end" hint="Both of these are shown to customers.">
              <input
                id="maintenance-end"
                type="datetime-local"
                value={draft.end}
                disabled={!canChange || off}
                onChange={(event) => update({ end: event.target.value })}
                className={control}
              />
            </Field>
            <Field
              label="Scheduled start (UTC, optional)"
              htmlFor="maintenance-start"
              hint="Empty applies it as soon as it is saved. Before a later start, customers see only the banner."
            >
              <input
                id="maintenance-start"
                type="datetime-local"
                value={draft.start}
                disabled={!canChange || off}
                onChange={(event) => update({ start: event.target.value })}
                className={control}
              />
            </Field>
          </div>
        </div>

        {formError && (
          <p role="alert" className="m-0 mt-4 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
            {formError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            {canChange ? null : "Read-only. Only a super admin can change maintenance mode."}
          </span>
          <span className="flex items-center gap-2">
            {canChange && dirty && (
              <Button type="button" variant="ghost" onClick={() => { setDraft(baseline); setFormError(null); }}>
                Discard
              </Button>
            )}
            <Button type="button" onClick={review} disabled={!canChange || !dirty}>
              Review change
            </Button>
          </span>
        </div>
      </SettingsCard>

      {/* ── Preview column ──────────────────────────────────────────────── */}
      <SettingsCard
        title="Customer preview"
        sub={
          draft.level === "locked"
            ? "What a customer sees at /maintenance."
            : off
              ? "Customers see nothing while maintenance is off."
              : "What a customer sees at the top of every page in the app."
        }
      >
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] p-5 text-center" aria-live="polite">
          {draft.level === "locked" ? (
            <>
              <div className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">We&rsquo;ll be back shortly</div>
              <p className="m-0 mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                Insurvas is offline for scheduled maintenance. Nothing has been lost.
              </p>
              <p className="m-0 mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] break-words">
                {draft.message.trim() || <span className="text-[var(--muted)]">Your message appears here.</span>}
              </p>
              <p className="m-0 mt-2.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">
                {endIso ? `Expected back by ${utcDateTime(endIso)}` : "No end time has been published yet"}
              </p>
            </>
          ) : off ? (
            <>
              <div className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Nothing is shown</div>
              <p className="m-0 mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                Customers use the product as normal.
              </p>
            </>
          ) : (
            <>
              <div className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                {PREVIEW_TITLE[draft.level as "banner_only" | "read_only"]}
              </div>
              <p className="m-0 mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] break-words">
                {draft.message.trim() || <span className="text-[var(--muted)]">Your message appears here.</span>}
              </p>
              {draft.level === "read_only" && endIso && (
                <p className="m-0 mt-2.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">
                  Expected end: {utcDateTime(endIso)}
                </p>
              )}
            </>
          )}
          {futureStart && draft.level !== "banner_only" && (
            <p className="m-0 mt-2.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
              Until {utcDateTime(futureStart)} customers see only the banner.
            </p>
          )}
        </div>
      </SettingsCard>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-[560px]">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
                {levelChanged ? `${LEVEL_LABEL[baseline.level]} → ${LEVEL_LABEL[draft.level]}` : `Stays ${LEVEL_LABEL[draft.level].toLowerCase()}; the details change.`}
                {!off && endIso ? ` · ends ${utcDateTime(endIso)}` : ""}
              </DialogDescription>
            </DialogHeader>

            <Callout tone={effect.tone} title={effect.title}>
              {effect.body}
              {futureStart && ` It starts at ${utcDateTime(futureStart)}; until then customers see only the banner.`}
            </Callout>

            <Field
              label="Reason"
              htmlFor="maintenance-reason"
              required
              hint={`${MAINTENANCE_REASON_MIN}–${MAINTENANCE_REASON_MAX} characters. Recorded in the audit log for good.`}
            >
              <textarea
                id="maintenance-reason"
                required
                rows={3}
                minLength={MAINTENANCE_REASON_MIN}
                maxLength={MAINTENANCE_REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Dialer database upgrade"
                className={cn(control, "h-auto py-2")}
              />
            </Field>

            {needsLockPhrase && (
              <Field
                label={
                  <>
                    Type <span className="font-mono">{LOCK_CONFIRM_PHRASE}</span> to confirm
                  </>
                }
                htmlFor="maintenance-lock-confirm"
                required
              >
                <input
                  id="maintenance-lock-confirm"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  className={control}
                />
              </Field>
            )}

            {saveError && (
              <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                {saveError}
              </p>
            )}

            <DialogFooter>
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className={btn("ghost")}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !reasonOk || !phraseOk}
                className={danger ? cn(btn("primary"), "bg-[var(--error)] text-[var(--on-error)] hover:bg-[var(--error-ink)]") : btn("primary")}
              >
                {saving ? "Saving…" : levelChanged ? dialogTitle : "Save changes"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
