"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RULE_SOURCES, RULE_TYPE_LABELS, type RuleSource, type RuleType } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";
import { carrierRulesHref, type DotState } from "@/lib/pipelineRules/carrierCoverageModel";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/app/carrier-rules";
export const SOURCE_SHORT: Record<RuleSource, string> = { carrier_agreement: "Agreement", phone_call: "Phone call", observed: "Observed" };

export type WindowRule = {
  id: string;
  scope: "agency" | "platform";
  windowDays: number | null;
  graceDays: number | null;
  redraftAttempts: number | null;
  redraftIntervalDays: number | null;
  source: string | null;
  notes: string | null;
  effectiveFrom: string;
  verified: boolean;
};

export type WindowRow = {
  type: RuleType;
  state: DotState;
  /** The rule in force today: the agency's own, else Insurvas's. */
  rule: WindowRule | null;
  /** Insurvas's own rule, what "Back to Insurvas's" returns to. */
  insurvas: WindowRule | null;
  /** The agency's own rule dated after today. */
  upcoming: WindowRule | null;
  /** What the missing window costs, in words. */
  cost: string;
};

/** One window of one carrier: what a grid cell, a carrier page row and the Set buttons open. */
export type WindowItem = { carrierId: string; carrierName: string; row: WindowRow };

export const days = (n: number | null) => (n === null ? "—" : `${n} d`);
export const windowLabel = (type: RuleType) => RULE_TYPE_LABELS[type].label;
export const sourceWord = (source: string | null) => (source && source in SOURCE_SHORT ? SOURCE_SHORT[source as RuleSource] : source ? source : "Source not said");

export function redraftText(rule: WindowRule) {
  if (rule.redraftAttempts === null) return "—";
  const tries = `${rule.redraftAttempts} ${rule.redraftAttempts === 1 ? "try" : "tries"}`;
  return rule.redraftIntervalDays === null || rule.redraftAttempts < 2 ? tries : `${tries} · ${rule.redraftIntervalDays} d apart`;
}

/** Whose value it is: Insurvas's, or yours from a date. */
export const whose = (rule: WindowRule) => (rule.scope === "agency" ? `yours, from ${fileDay(rule.effectiveFrom)}` : "Insurvas's");

/** The agency's own rule that starts later, said after whose the rule in force is. */
export const upcomingText = (row: WindowRow) => (row.upcoming ? `yours ${days(row.upcoming.windowDays)} from ${fileDay(row.upcoming.effectiveFrom)}` : null);

/** The source with its verified mark; an unverified value keeps its grey "· unverified" wherever it is shown. */
export function SourceChip({ source, verified }: { source: string | null; verified: boolean }) {
  return <StatusChip tone={verified ? "good" : "neutral"} dot>{`${sourceWord(source)} · ${verified ? "verified" : "unverified"}`}</StatusChip>;
}

/** A carrier page's History tab, filtered to one window. */
export const windowHistoryHref = (carrierId: string, type?: RuleType) => `${carrierRulesHref(carrierId)}?tab=history${type ? `&window=${type}` : ""}`;

/** Dialog lg 560 (UI-CONSISTENCY §11): seven short fields in two rows. */
const DIALOG_SIZE = "lg" as const;

/** The dialog fills the screen on a phone, Save at its foot (board 1·7). */
const PHONE_FULL = "max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:grid-rows-[auto_1fr_auto] max-sm:overflow-y-auto max-sm:rounded-none";

type Draft = { window: string; grace: string; attempts: string; interval: string; source: RuleSource; from: string; note: string };
const num = (value: string) => (value.trim() === "" ? null : Number(value));
const digits = (value: string) => value.replace(/\D/g, "");
const NONE_ERROR = "Enter at least one of Closes after, Grace or Redraft tries.";

function draftOf(row: WindowRow, asOf: string): Draft {
  const base = row.rule;
  return {
    window: base?.windowDays?.toString() ?? "", grace: base?.graceDays?.toString() ?? "", attempts: base?.redraftAttempts?.toString() ?? "", interval: base?.redraftIntervalDays?.toString() ?? "",
    source: (base?.scope === "agency" && (RULE_SOURCES as readonly string[]).includes(base.source ?? "") ? base.source : "carrier_agreement") as RuleSource,
    from: asOf, note: "",
  };
}

/**
 * The window dialog (board 1·4, Dialog lg): what a grid cell, a carrier page row, "Set N windows" and "Set the next
 * window" open. Closes after, grace, redraft tries and days apart, from, where it's from and a note: today's editor,
 * moved out of the row. Each save is a new dated rule (add_rule); past countdowns keep the rule they used. Opened from
 * a Set button it steps through its queue ("1 of 2", Save and next). Back to Insurvas's and Mark it verified ask first
 * and show only for the agency's own rule. A server error stays on the dialog's error line. Read-only: the values as
 * text, History and Close.
 */
export function WindowDialog({ queue, stepping, asOf, readOnly, onClose }: { queue: WindowItem[]; stepping: boolean; asOf: string; readOnly: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const item = queue[Math.min(index, queue.length - 1)];
  if (!item) return null;
  const next = stepping && index < queue.length - 1 ? () => setIndex(index + 1) : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size={DIALOG_SIZE} className={PHONE_FULL}>
        <WindowForm key={`${item.carrierId}:${item.row.type}`} item={item} asOf={asOf} readOnly={readOnly} position={stepping && queue.length > 1 ? `${index + 1} of ${queue.length}` : null} onNext={next} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function WindowForm({ item, asOf, readOnly, position, onNext, onClose }: { item: WindowItem; asOf: string; readOnly: boolean; position: string | null; onNext: (() => void) | null; onClose: () => void }) {
  const router = useRouter();
  const { carrierId, carrierName, row } = item;
  const [draft, setDraft] = useState<Draft>(() => draftOf(row, asOf));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = row.rule?.scope === "agency";
  const none = !draft.window && !draft.grace && !draft.attempts;
  const shownError = error ?? (touched && none ? NONE_ERROR : null);
  const id = (part: string) => `${carrierId}-${row.type}-${part}`;
  const change = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setTouched(true); setError(null); };

  async function post(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(done);
      router.refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(andNext: boolean) {
    if (none) { setTouched(true); return; }
    const from = draft.from || asOf;
    const ok = await post({
      action: "add_rule", carrier_id: carrierId, rule_type: row.type,
      window_days: num(draft.window), grace_days: num(draft.grace), redraft_attempts: num(draft.attempts), redraft_interval_days: num(draft.interval),
      source: draft.source, notes: draft.note.trim() || null, effective_from: from,
    }, row.rule ? `${carrierName}: your ${RULE_TYPE_LABELS[row.type].window} applies from ${fileDay(from)}.` : `${windowLabel(row.type)} window set from ${fileDay(from)}.`);
    if (!ok) return;
    if (andNext && onNext) onNext();
    else onClose();
  }

  async function backToInsurvas() {
    const ok = await confirmAction({
      title: "Back to Insurvas's?",
      description: row.insurvas ? `From today ${carrierName} uses Insurvas's ${windowLabel(row.type).toLowerCase()} window (${days(row.insurvas.windowDays)}) for your agency. Past countdowns keep the rule they used.` : `Insurvas has no ${windowLabel(row.type).toLowerCase()} window for ${carrierName}, so from today it is not set. Past countdowns keep the rule they used.`,
      confirmLabel: "Use Insurvas's",
      cancelLabel: "Keep mine",
      destructive: false,
    });
    if (ok && await post({ action: "clear_override", carrier_id: carrierId, rule_type: row.type }, "Back to Insurvas's rule.")) onClose();
  }

  async function verify() {
    if (!row.rule) return;
    const ok = await confirmAction({
      title: "Mark it verified?",
      description: `"${windowLabel(row.type)} · ${days(row.rule.windowDays)}" will show without the unverified mark, recorded as verified by you today.`,
      confirmLabel: "Verify",
      destructive: false,
    });
    if (ok && await post({ action: "verify", rule_id: row.rule.id }, `${windowLabel(row.type)} window verified.`)) onClose();
  }

  const history = <Link href={windowHistoryHref(carrierId, row.type)} onClick={onClose} className="text-xs font-medium text-[var(--accent-ink)] hover:underline">History of this window ›</Link>;

  return (
    <>
      <DialogHeader>
        <div className="flex items-baseline gap-3 pr-8">
          <DialogTitle className="min-w-0 flex-1">{carrierName} · {windowLabel(row.type)} window</DialogTitle>
          {position && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{position}</span>}
        </div>
        <DialogDescription asChild>
          {row.rule ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <SourceChip source={row.rule.source} verified={row.rule.verified} />
              <span>{[whose(row.rule), upcomingText(row)].filter(Boolean).join(" · ")}</span>
            </div>
          ) : (
            <p>Not set · {row.cost}.{row.upcoming ? ` ${upcomingText(row)}.` : ""}</p>
          )}
        </DialogDescription>
      </DialogHeader>

      {readOnly ? (
        <dl className="grid grid-cols-[150px_1fr] overflow-hidden rounded-md border border-border text-sm [&>div:last-child>*]:border-0">
          {([
            ["Closes after", row.rule ? `${days(row.rule.windowDays)}${row.rule.windowDays === null ? "" : " from paid-to"}` : "Not set"],
            ["Grace", row.rule ? days(row.rule.graceDays) : "—"],
            ["Redraft", row.rule ? redraftText(row.rule) : "—"],
            ["Where it's from", row.rule ? sourceWord(row.rule.source) : "—"],
            ["From", row.rule ? fileDay(row.rule.effectiveFrom) : "—"],
            ["Note", row.rule?.notes || "—"],
          ] as const).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="border-b border-border bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold text-muted-foreground">{key}</dt>
              <dd className="border-b border-border px-3 py-2 text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="grid content-start gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Closes after" htmlFor={id("window")} hint="days from paid-to">
              <input id={id("window")} autoFocus className={cn(control, shownError === NONE_ERROR && "border-[var(--error)]")} inputMode="numeric" value={draft.window} onChange={(e) => change({ window: digits(e.target.value) })} />
            </Field>
            <Field label="Grace" htmlFor={id("grace")} hint="days">
              <input id={id("grace")} className={cn(control, shownError === NONE_ERROR && "border-[var(--error)]")} inputMode="numeric" value={draft.grace} onChange={(e) => change({ grace: digits(e.target.value) })} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Redraft tries" htmlFor={id("attempts")}>
              <input id={id("attempts")} className={cn(control, shownError === NONE_ERROR && "border-[var(--error)]")} inputMode="numeric" value={draft.attempts} onChange={(e) => change({ attempts: digits(e.target.value) })} />
            </Field>
            <Field label="Days apart" htmlFor={id("interval")}>
              <input id={id("interval")} className={control} inputMode="numeric" value={draft.interval} onChange={(e) => change({ interval: digits(e.target.value) })} />
            </Field>
            <Field label="From" htmlFor={id("from")}>
              <input id={id("from")} type="date" className={control} value={draft.from} onChange={(e) => change({ from: e.target.value })} />
            </Field>
          </div>
          {shownError && <p role="alert" className="text-sm font-medium text-[var(--error-ink)]">{shownError}</p>}
          <div>
            <span className="text-label text-[var(--body)]">Where it&apos;s from</span>
            <span role="radiogroup" aria-label="Where it's from" className="mt-1.5 flex flex-wrap gap-2">
              {RULE_SOURCES.map((source) => <ToggleChip key={source} role="radio" selected={draft.source === source} onClick={() => change({ source })}>{SOURCE_SHORT[source]}</ToggleChip>)}
            </span>
          </div>
          <Field label="Note" htmlFor={id("note")}>
            <input id={id("note")} className={control} maxLength={1000} placeholder="Who confirmed it, and when" value={draft.note} onChange={(e) => change({ note: e.target.value })} />
          </Field>
        </div>
      )}

      <DialogFooter className="border-t border-border pt-4 sm:items-center">
        {readOnly ? (
          <>
            <span className="self-center">{history}</span>
            <span className="hidden flex-1 sm:block" />
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            {own && <Button type="button" variant="ghost" disabled={busy} onClick={() => void backToInsurvas()}>Back to Insurvas&apos;s</Button>}
            {own && row.rule && !row.rule.verified && <Button type="button" variant="outline" disabled={busy} onClick={() => void verify()}>Mark it verified</Button>}
            {!own && <span className="self-center">{history}</span>}
            <span className="hidden flex-1 sm:block" />
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="button" variant={onNext ? "outline" : "default"} disabled={busy || none} onClick={() => void save(false)}>Save</Button>
            {onNext && <Button type="button" disabled={busy || none} onClick={() => void save(true)}>Save and next ›</Button>}
          </>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The title line's one primary: "Set the next window" (the grid) or "Set N windows" (a carrier). It opens the window
 * dialog on the costliest gap and steps through the queue. Paused while read-only, with the reason on hover.
 */
export function WindowQueueButton({ queue, asOf, readOnly, label }: { queue: WindowItem[]; asOf: string; readOnly: boolean; label: string }) {
  const [open, setOpen] = useState<WindowItem[] | null>(null);
  const reason = readOnly ? "Paused while the account is read-only." : queue.length === 0 ? "Every window is set." : null;
  return (
    <>
      <span title={reason ?? undefined} className="inline-flex">
        <Button type="button" disabled={Boolean(reason)} onClick={() => setOpen(queue)}>{label}</Button>
      </span>
      {open && <WindowDialog queue={open} stepping asOf={asOf} readOnly={readOnly} onClose={() => setOpen(null)} />}
    </>
  );
}
