"use client";

/**
 * The Settings content patterns (settings-redesign R3): the parts every Settings page is rebuilt from,
 * on top of primitives.tsx and the kit in components/ui. The rules for using them are on
 * /design/settings/patterns, next to each part.
 *
 *  - FormSection   a group of settings: its title (with an (i) for the why) and its fields in a card,
 *                  either stacked above the card or, in the R3 "split" layout, beside it.
 *  - FieldRow      fields side by side inside a FormSection (short fields share a row).
 *  - Advanced      rarely changed settings, folded away; opens by itself when a link points inside.
 *  - DangerZone    the section's destructive actions, last, each behind a confirmation.
 *  - AutosaveNote  "Saving… / Saved / Couldn't save" beside a control that saves the moment it changes.
 *
 * Draft forms use the existing SettingsSaveBar + DraftActions + LeaveGuard; 2–5 choices use Segmented
 * (components/ui/view-tabs.tsx); on/off uses ToggleRow / Switch (components/ui/field.tsx).
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { confirmAction, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

/* ── form section ──────────────────────────────────────────────────────────────────────────── */

/**
 * One group of settings. Its title says what the group is for; why it exists sits behind the (i)
 * beside the title (`info`, owner 2026-10-29: text across the page is overwhelming). `help` is for
 * one short line that must be read to fill the group in, and `aside` for a status or a link.
 *
 * Two layouts. "stacked" (the default; owner's choice, 2026-10-29): the title row above a full-width
 * card, with `aside` at the row's end. "split" (R3, kept for comparison): the title on the left, the
 * card on the right.
 */
export function FormSection({ id, title, info, infoLabel, help, aside, layout = "stacked", children, className }: {
  id?: string;
  title: ReactNode;
  /** Why the group exists, behind the (i): one or two plain sentences. */
  info?: ReactNode;
  /** The (i)'s accessible name when the title is not plain text. */
  infoLabel?: string;
  help?: ReactNode;
  /** A status chip or a link to where this is used. */
  aside?: ReactNode;
  layout?: "split" | "stacked";
  children: ReactNode;
  className?: string;
}) {
  const heading = (
    <div className="flex min-w-0 items-center gap-1">
      <h3 className="m-0 text-card-title text-[var(--ink)]">{title}</h3>
      {info && <InfoTip label={infoLabel ?? (typeof title === "string" ? `About ${title.toLowerCase()}` : "About this section")}>{info}</InfoTip>}
    </div>
  );
  const helpLine = help && <p className="m-0 mt-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{help}</p>;
  const card = <div className="m-glass flex min-w-0 flex-col gap-4 rounded-[12px] border border-[var(--border)] p-4">{children}</div>;

  if (layout === "stacked") {
    return (
      <section id={id} className={cn("flex min-w-0 scroll-mt-24 flex-col gap-2.5", className)}>
        <div>
          <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
            {heading}
            {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
          </div>
          {helpLine}
        </div>
        {card}
      </section>
    );
  }
  return (
    <section id={id} className={cn("grid scroll-mt-24 gap-3 border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-8", className)}>
      <div className="min-w-0">
        {heading}
        {helpLine}
        {aside && <div className="mt-3">{aside}</div>}
      </div>
      {card}
    </section>
  );
}

/** The column of FormSections that makes up a page or a tab. */
export function FormSections({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-6", className)}>{children}</div>;
}

/** Fields that share a row inside a FormSection: two on wide screens, one on narrow. */
export function FieldRow({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn("grid min-w-0 gap-4", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>{children}</div>;
}

/** A hairline between groups of fields inside one FormSection card. */
export function FieldDivider() {
  return <hr className="m-0 border-0 border-t border-[var(--border)]" />;
}

/* ── advanced ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Settings most agencies never change, folded under one line. Closed by default; opens when the page's
 * link names something inside it (#section/anchor), so search and deep links still land.
 */
export function Advanced({ summary = "Advanced", hint, children }: { summary?: string; hint?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const open = () => {
      const anchor = window.location.hash.split("/")[1];
      if (anchor && ref.current?.querySelector(`#${CSS.escape(anchor)}`)) ref.current.open = true;
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return (
    <details ref={ref} className="group min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-label text-[var(--body)] hover:text-[var(--ink)] [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-4 text-[var(--muted)] transition-transform group-open:rotate-90" />
        {summary}
        {hint && <span className="text-xs font-normal text-[var(--muted)]">{hint}</span>}
      </summary>
      <div className="mt-4 flex min-w-0 flex-col gap-6">{children}</div>
    </details>
  );
}

/* ── danger zone ───────────────────────────────────────────────────────────────────────────── */

/** The last block of a section: what can't be undone, apart from everything else. */
export function DangerZone({ title = "Danger zone", children }: { title?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-[var(--border)] pt-6">
      <h3 className="m-0 text-card-title text-[var(--error-ink)]">{title}</h3>
      <div className="mt-3 divide-y divide-[var(--border)] rounded-[12px] border border-[color-mix(in_srgb,var(--error)_45%,var(--border))]">{children}</div>
    </section>
  );
}

/**
 * One destructive action: what it does and what is lost, and an outlined red button that asks first.
 * The question is the kit's confirmAction (a red "Turn off" / "Cancel subscription" and a way back).
 */
export function DangerAction({ title, consequence, label, confirm, onConfirm, disabled }: {
  title: ReactNode;
  consequence: ReactNode;
  label: string;
  /**
   * The question asked first. Leave it out only when `onConfirm` opens its own destructive dialog
   * (one that needs input, such as a code), so a question is always asked.
   */
  confirm?: Omit<ConfirmOptions, "destructive">;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (confirm && !(await confirmAction({ ...confirm, destructive: true }))) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-label text-[var(--ink)]">{title}</p>
        <p className="mt-1 text-sm leading-[1.5] text-[var(--muted)]">{consequence}</p>
      </div>
      <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void run()} className="border-[color-mix(in_srgb,var(--error)_55%,var(--border))] text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]">
        {busy ? "Working…" : label}
      </Button>
    </div>
  );
}

/* ── autosave ──────────────────────────────────────────────────────────────────────────────── */

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/**
 * For a control that saves the moment it changes (a switch, a segmented choice): run the save and
 * report it. "Saved" shows for a few seconds and goes; an error stays, with Retry.
 */
export function useAutosave() {
  const [state, setState] = useState<AutosaveState>("idle");
  const timer = useRef<number | null>(null);
  const last = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const run = useCallback(async (save: () => Promise<void>) => {
    last.current = save;
    if (timer.current) window.clearTimeout(timer.current);
    setState("saving");
    try {
      await save();
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  }, []);
  const retry = useCallback(() => { if (last.current) void run(last.current); }, [run]);
  return { state, run, retry: state === "error" ? retry : null };
}

/** The quiet line beside an autosaving control. Announced politely; takes no space when idle. */
export function AutosaveNote({ state, onRetry }: { state: AutosaveState; onRetry?: (() => void) | null }) {
  const id = useId();
  return (
    <span id={id} role="status" aria-live="polite" className={cn("text-xs", state === "error" ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && (<>Couldn&rsquo;t save. {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline-offset-2 hover:underline">Retry</button>}</>)}
    </span>
  );
}
