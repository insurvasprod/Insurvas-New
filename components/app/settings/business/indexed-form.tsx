"use client";

/**
 * Settings round 8 · Business identity + My profile, board A (owner pick 2026-11-12): one card, a
 * section index on the left that stays put (each section with a done / "1 to add" mark), the form
 * scrolling inside the card on the right, and ONE save bar at the card's foot. The page around it —
 * title, actions, the status line — never scrolls (the section is in OWN_SCROLL).
 *
 * Shared by both pages, so they read as one design: IndexedFormCard, FormBlock (a section of the
 * form), StatusLine, Seg (the joined switch), SaveFoot and TechnicalDetails ("Show technical details"
 * + Copy, so no raw id is on the page).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { SWITCH_FRAME, switchOption } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/* ── status line (no notice cards: owner rule 2026-11-02) ─────────────────── */

export type LineTone = "good" | "warning" | "danger" | "neutral";
const DOT: Record<LineTone, string> = {
  good: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--error)]",
  neutral: "bg-[var(--muted)]",
};

/** The page's state in one line under the title: saved / N unsaved / couldn't save / needs an update. */
export function StatusLine({ tone, children }: { tone: LineTone; children: ReactNode }) {
  return (
    <p role="status" className={cn("m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-[1.5]", tone === "danger" ? "text-[var(--error-ink)]" : "text-[var(--muted)]")}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </p>
  );
}

/** A link-looking button in the status line or the documents line. */
export function InlineAction({ onClick, children, tone = "accent" }: { onClick: () => void; children: ReactNode; tone?: "accent" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("font-medium underline-offset-2 outline-none hover:underline focus-visible:underline", tone === "danger" ? "text-[var(--error-ink)]" : "text-[var(--accent-ink)]")}
    >
      {children}
    </button>
  );
}

/* ── joined switch (the board's .seg) ─────────────────────────────────────── */

export function Seg<K extends string>({ label, options, value, onChange, disabled = false, size = "sm", className }: {
  label: string;
  options: ReadonlyArray<{ key: K; label: ReactNode; title?: string }>;
  value: K | null;
  onChange: (key: K) => void;
  disabled?: boolean;
  size?: "sm" | "xs";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn(SWITCH_FRAME, size === "xs" && "h-8", "max-w-full overflow-x-auto", className)}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.key)}
          className={switchOption(value === option.key, cn("shrink-0 whitespace-nowrap font-medium", size === "xs" ? "h-6 px-2.5 text-xs" : "h-8 px-3 text-sm"))}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── the card: index + scrolling form + one foot ──────────────────────────── */

export type IndexMark = { tone: "ok" | "warn" | "muted"; text: string };
export type IndexEntry = { id: string; label: string; mark?: IndexMark | null };

const MARK: Record<IndexMark["tone"], string> = {
  ok: "text-[var(--success-ink)]",
  warn: "text-[var(--warning-ink)]",
  muted: "text-[var(--muted)]",
};

/** Scroll the form (not the page) so a section's top meets the card's top. */
export function scrollToSection(container: HTMLElement | null, id: string) {
  const target = document.getElementById(id);
  if (!container || !target) return;
  const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8;
  container.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/** The section in view: the last one whose top has passed the card's top (the last one at the very end). */
function useActiveSection(container: HTMLElement | null, ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");
  useEffect(() => {
    if (!container) return;
    const list = key ? key.split("|") : [];
    const update = () => {
      const top = container.getBoundingClientRect().top + 24;
      let current = list[0] ?? null;
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= top) current = id;
      }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4 && list.length) current = list[list.length - 1];
      setActive(current);
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { container.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [container, key]);
  return active;
}

export function IndexedFormCard({ label, sections, foot, top, footer, children }: {
  /** The card's accessible name ("Business identity"). */
  label: string;
  sections: readonly IndexEntry[];
  /** The index's last line: how this page saves. */
  foot: ReactNode;
  /** A line pinned above the form (the documents-ready line). */
  top?: ReactNode;
  /** The one save bar (or "All changes saved"). */
  footer: ReactNode;
  children: ReactNode;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const active = useActiveSection(scroller, sections.map((section) => section.id));
  return (
    <section aria-label={label} className={cn(cardSurface, "flex min-h-0 min-w-0 flex-1 overflow-hidden")}>
      <nav aria-label={`${label} sections`} className="hidden w-[208px] shrink-0 flex-col gap-0.5 border-r border-[var(--border)] py-3 pl-3 md:flex">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={active === section.id ? "location" : undefined}
            onClick={(event) => { event.preventDefault(); scrollToSection(scroller, section.id); }}
            className={cn(
              "mr-3 flex items-center gap-2 rounded-[8px] px-2.5 py-[7px] text-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]",
              active === section.id ? "bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--hover-wash)] hover:text-[var(--ink)]",
            )}
          >
            <span className="min-w-0 truncate">{section.label}</span>
            {section.mark ? <span className={cn("ml-auto shrink-0 text-xs font-semibold", MARK[section.mark.tone])}>{section.mark.text}</span> : null}
          </a>
        ))}
        <p className="m-0 mt-auto pt-2.5 pr-5 pl-2.5 text-xs leading-[1.5] text-[var(--muted)]">{foot}</p>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {top}
        <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain @container">
          <div className="px-4 py-3.5">{children}</div>
        </div>
        {footer}
      </div>
    </section>
  );
}

/** One section of the form: a 16px heading, one muted line, then its fields. */
export function FormBlock({ id, title, sub, aside, children }: { id: string; title: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-2 border-t border-[var(--border)] py-4 first:border-t-0 first:pt-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h3 id={`${id}-title`} className="m-0 mb-0.5 text-base font-semibold text-[var(--ink)]">{title}</h3>
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
      {sub ? <p className="m-0 mb-3 text-xs text-[var(--muted)]">{sub}</p> : null}
      {children}
    </section>
  );
}

/** The card's foot: the one save bar while something is unsaved, "All changes saved" otherwise. */
export function SaveFoot({ count, what, saving, disabled, onDiscard, onSave }: {
  count: number;
  /** What changed, in words ("legal name, ZIP code"). */
  what: string;
  saving: boolean;
  /** Save cannot run (a database update is missing, or the form has a problem the status line names). */
  disabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
        <span>All changes saved</span>
        <Button type="button" size="sm" className="ml-auto" disabled>Save changes</Button>
      </div>
    );
  }
  return (
    <div role="region" aria-label="Unsaved changes" className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--highlight-soft)] px-4 py-2.5 text-sm font-medium text-[var(--highlight-ink)]">
      <span className="min-w-0">{count} unsaved {count === 1 ? "change" : "changes"}{what ? ` · ${what}` : ""}</span>
      <span className="ml-auto flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>Discard</Button>
        <Button type="button" size="sm" disabled={saving || disabled} onClick={onSave}>{saving ? "Saving…" : "Save changes"}</Button>
      </span>
    </div>
  );
}

/** "Show technical details": an id support may ask for, with Copy. Never on the page itself. */
export function TechnicalDetails({ label, value }: { label: string; value: string }) {
  const copy = useCallback(() => {
    const write = navigator.clipboard?.writeText(value);
    if (!write) { notify.fail("Could not copy. Select the text and copy it yourself."); return; }
    void write.then(() => notify.done("Copied"), () => notify.fail("Could not copy. Select the text and copy it yourself."));
  }, [value]);
  return (
    <details className="mt-3 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none text-xs font-semibold text-[var(--accent-ink)] outline-none focus-visible:underline">Show technical details</summary>
      <p className="m-0 mt-2 mb-1.5 text-xs text-[var(--muted)]">Support may ask for this. You never need to type it.</p>
      <div className="flex h-9 max-w-[460px] items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] py-0 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ink)]">{label} {value}</span>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>Copy</Button>
      </div>
    </details>
  );
}
