"use client";

/**
 * Settings › Sales process (round 8, owner pick A, 2026-11-12): the pieces every tab of the section shares.
 *
 *   StatusLine  the one line under the title that says where the page stands ("Saved · changed by Dana, 2 days
 *               ago", "v2 draft, not live", "Couldn't save, try again"). The foundation board's rule: a status
 *               line, never a notice card.
 *   Pane        a card whose body scrolls inside it (the page never scrolls on a desktop), with its title row and
 *               an optional foot.
 *   ThreeWay    the board's segmented choice (Not asked · Optional · Required, Block · Warn…), the shared switch look.
 *   GoldCount   a count of things that need you: the gold role (people, new counts, a reached goal).
 *   SheetSection / SheetAnchors  a record's sheet in titled sections, with an index that scrolls to each one —
 *               never a second row of tabs.
 *   useDraftAutosave  templates save into their draft as they are edited (Draft → Publish is the one save model).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cardSurface } from "@/components/ui/card";
import { SWITCH_FRAME, switchOption } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";

/* ── status line ───────────────────────────────────────────────────────── */

export type StatusTone = "ok" | "warn" | "bad" | "muted";
const DOT: Record<StatusTone, string> = {
  ok: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  bad: "bg-[var(--error)]",
  muted: "bg-[var(--muted)]",
};

export function StatusLine({ tone = "ok", children, action }: { tone?: StatusTone; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-[1.5] text-[var(--body)]">
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span className={cn("min-w-0", tone === "bad" && "text-[var(--error-ink)]", tone === "warn" && "text-[var(--warning-ink)]")}>{children}</span>
      {action}
    </div>
  );
}

/* ── pane: a card that scrolls inside ──────────────────────────────────── */

export function Pane({ title, sub, actions, footer, children, className, bodyClassName, label }: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Accessible name when the title is not plain text. */
  label?: string;
}) {
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col", className)}>
      {(title || actions) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            {title && <h3 className="m-0 text-sm leading-[1.5] font-semibold text-[var(--ink)]">{title}</h3>}
            {sub && <span className="text-xs leading-[1.5] text-[var(--muted)]">{sub}</span>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("min-h-0 flex-1 lg:overflow-y-auto lg:overscroll-contain", bodyClassName)}>{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-sm text-[var(--body)]">{footer}</div>}
    </section>
  );
}

/** The tab's body: its cards side by side on a desktop, filling what the window leaves; stacked on a phone. */
export function TabBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:items-stretch", className)}>{children}</div>;
}

/** The tab's column: the status line, then the body. */
export function TabFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-full">{children}</div>;
}

/* ── a list row that opens a record ────────────────────────────────────── */

/** One selectable row in a pane's list (a question set, a carrier, a document needing you). */
export function SelectRow({ selected, onClick, title, sub, end, label }: { selected?: boolean; onClick: () => void; title: ReactNode; sub?: ReactNode; end?: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]",
        selected ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--ink)]">{title}</span>
        {sub && <span className="block truncate text-xs text-[var(--muted)]">{sub}</span>}
      </span>
      {end !== undefined && <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{end}</span>}
    </button>
  );
}

/* ── choices ───────────────────────────────────────────────────────────── */

export function ThreeWay<K extends string>({ label, value, options, onChange, disabled, size = "sm" }: {
  label: string;
  value: K;
  options: ReadonlyArray<{ key: K; label: string }>;
  onChange: (key: K) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn(SWITCH_FRAME, size === "sm" && "h-8")}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => { if (!on) onChange(option.key); }}
            className={switchOption(on, cn("whitespace-nowrap font-medium", size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm"))}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A count of things that need you, in gold (colour roles: gold for new counts). Nothing at zero. */
export function GoldCount({ value, label }: { value: number; label?: string }) {
  if (!value) return null;
  return (
    <span aria-label={label} className="inline-flex h-5 shrink-0 items-center rounded-[6px] bg-[var(--highlight-soft)] px-1.5 text-xs font-bold tabular-nums text-[var(--highlight-ink)]">
      {value.toLocaleString("en-US")}
    </span>
  );
}

/* ── a record's sheet in sections ──────────────────────────────────────── */

export function SheetSection({ id, title, sub, children }: { id?: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex scroll-mt-14 flex-col gap-3 border-b border-[var(--border)] pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="m-0 text-sm leading-[1.5] font-semibold text-[var(--ink)]">{title}</h3>
        {sub && <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The sheet's index (the board's "Wording · When required · Call scripts · Versions"): links that scroll the
 * sheet to a section, the one in view underlined. Not tabs: every section stays on the one scrolling sheet.
 */
export function SheetAnchors({ items }: { items: ReadonlyArray<{ id: string; label: string }> }) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const body = ref.current?.closest("[data-slot=detail-panel]")?.querySelector<HTMLElement>(".overflow-y-auto");
    if (!body) return;
    const onScroll = () => {
      let seen = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top - body.getBoundingClientRect().top < 80) seen = item.id;
      }
      setCurrent(seen);
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => body.removeEventListener("scroll", onScroll);
  }, [items]);
  return (
    <nav ref={ref} aria-label="Sections" className="sticky top-0 z-[1] -mx-4 -mt-4 mb-1 flex gap-4 overflow-x-auto border-b border-[var(--border)] bg-card px-4">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={current === item.id ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            setCurrent(item.id);
            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={cn(
            "inline-flex h-9 shrink-0 items-center border-b-2 text-sm font-medium whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]",
            current === item.id ? "border-[var(--primary)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** A wide sheet (the board's `sheet wide`): the shared Sheet at 640px on a desktop. */
export const WIDE_SHEET = "lg:w-[640px]";

/* ── Draft → Publish: edits save into the draft as they are made ───────── */

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/**
 * Saves `signature` (the draft as the server would store it) a moment after the last edit, one save at a time.
 * `save` resolves true when stored. A failed save waits for the next edit; the same draft is never sent twice,
 * so a server that tidies what it stores cannot start a loop.
 */
export function useDraftAutosave({ signature, dirty, enabled, save, delay = 700 }: {
  signature: string;
  dirty: boolean;
  enabled: boolean;
  save: () => Promise<boolean>;
  delay?: number;
}) {
  const [state, setState] = useState<AutosaveState>("idle");
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  const lastSent = useRef<string | null>(null);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  useEffect(() => {
    if (!enabled || !dirty || signature === lastSent.current) return;
    const timer = window.setTimeout(async () => {
      if (busy.current) { setTick((n) => n + 1); return; }
      busy.current = true;
      lastSent.current = signature;
      setState("saving");
      const ok = await saveRef.current().catch(() => false);
      busy.current = false;
      setState(ok ? "saved" : "error");
      setTick((n) => n + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [signature, dirty, enabled, delay, tick]);

  /** A new record was opened: forget what was sent for the last one. */
  const reset = () => { lastSent.current = null; setState("idle"); };
  return { state, reset };
}
