"use client";

/**
 * The settings boards' vocabulary, once.
 *
 * Thirteen sections were each drawing their own card, table and callout, and no two agreed on a
 * padding. Every board in the p-set-* set is built from the same nine parts — a section header, a
 * callout, a card, a table card, a pill, a field, a toggle row, a key/value pair and a meter — so
 * those are the parts, and a section composes them rather than restyling shadcn per page.
 *
 * Tokens only, no hexes: the boards are light-only, and every value here has a dark twin in
 * globals.css.
 */

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { PILL_TONE, type PillTone } from "@/lib/ui/pillTone";

import { cn } from "@/lib/utils";
import { SectionLastChanged } from "@/components/app/settings/last-changed";
import { titleCaseNode } from "@/components/ui/title-case";

/* ── section header ─────────────────────────────────────────────────────── */

/**
 * `id` and `history` (LA-8.8): the section's registry id, and whether this viewer may read the
 * settings history — then the header says who last changed something here, linking into the log.
 */
type SectionMeta = {
  title: string;
  description: string;
  id?: string;
  history?: boolean;
  /**
   * Inside the Settings frame (settings-shell plan, 2026-10-28): the page header already shows the
   * section's title and purpose, top-left, so the section header draws neither, and its actions go
   * to the header's action slot on the title's line.
   */
  framed?: boolean;
  actionsSlot?: HTMLElement | null;
};
const SectionContext = createContext<SectionMeta | null>(null);

export function SettingsSectionProvider({ value, children }: { value: SectionMeta; children: ReactNode }) {
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

/**
 * The 18px title, the one-line purpose, and — only where the section really holds a draft — the
 * Discard / Save pair. Sections that save each edit as it is made pass no actions: a Save button
 * with nothing pending behind it is a control that lies.
 */
export function SettingsSectionHeader({ actions, trail }: {
  actions?: ReactNode;
  /**
   * A record open inside the section (owner 2026-10-28, Underwriting templates): drawn on the
   * title's own line after an arrow, with `actions` at the end of that line. The purpose line and
   * the last-changed note step aside while a record is open.
   */
  trail?: ReactNode;
}) {
  const meta = useContext(SectionContext);
  if (!meta) return null;
  if (meta.framed) {
    // One title per page: the frame's. A record open in the section keeps its own line here, with
    // its actions; otherwise the actions move up to the title's line. The history note is in the
    // frame's header too, under the purpose line (it floated above the tabs here).
    if (trail) {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[240px] flex-1 items-center gap-3">{trail}</div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
      );
    }
    return (
      <>
        {actions && (meta.actionsSlot ? createPortal(actions, meta.actionsSlot) : <div className="flex justify-end gap-2.5">{actions}</div>)}
      </>
    );
  }
  if (trail) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 shrink-0 text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{meta.title}</h2>
        <div className="flex min-w-[240px] flex-1 items-center gap-3">{trail}</div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
    );
  }
  return (
    // Wraps only on narrow screens. At desktop width the board keeps the pair on the right however
    // long the purpose line runs, so the text takes what is left rather than pushing them under it.
    <div className="flex flex-wrap items-end justify-between gap-6 lg:flex-nowrap">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-title-sm leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{meta.title}</h2>
        <p className="mt-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{meta.description}</p>
        {meta.history && meta.id && <SectionLastChanged sectionKey={meta.id} />}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** Discard + Save changes, 36px (the Button height), wired to a section's own draft. */
export function DraftActions({
  dirty,
  saving,
  onDiscard,
  onSave,
  saveLabel = "Save changes",
  disabled,
}: {
  dirty: boolean;
  saving?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </Button>
      <Button type="button" onClick={onSave} disabled={!dirty || saving || disabled}>
        {saving ? "Saving…" : saveLabel}
      </Button>
    </>
  );
}

/** The section column: blocks 20px apart. */
export function SettingsStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-5", className)}>{children}</div>;
}

/** Two columns, 24px apart, top-aligned — the boards' grid for paired cards. */
export function SettingsGrid({ children, className, cols = 2 }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  const c = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cn("grid items-start gap-6", c, className)}>{children}</div>;
}

/* ── buttons ────────────────────────────────────────────────────────────── */

type BtnKind = "primary" | "ghost" | "secondary" | "row" | "primary-sm" | "danger-row";
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[8px] border px-4 text-sm leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const BTN: Record<BtnKind, string> = {
  primary: "h-9 border-transparent bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--accent-hover)]",
  ghost: "h-9 border-transparent bg-transparent text-[var(--ink)] hover:bg-[var(--surface-alt)]",
  secondary: "h-8 border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]",
  "primary-sm": "h-8 border-transparent bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--accent-hover)]",
  row: "h-[30px] border-transparent bg-transparent px-3 text-[var(--ink)] hover:bg-[var(--surface-alt)]",
  "danger-row": "h-[30px] border-transparent bg-transparent px-3 text-[var(--error-ink)] hover:bg-[var(--error-surface)]",
};
export function btn(kind: BtnKind, className?: string) {
  return cn(BTN_BASE, BTN[kind], className);
}

/* ── callout ────────────────────────────────────────────────────────────── */

export type Tone = "info" | "success" | "warning" | "error";
const CALLOUT: Record<Tone, { edge: string; ground: string; ink: string }> = {
  info: { edge: "border-l-[var(--info)]", ground: "bg-[var(--info-surface)]", ink: "text-[var(--info-ink)]" },
  success: { edge: "border-l-[var(--success)]", ground: "bg-[var(--success-surface)]", ink: "text-[var(--success-ink)]" },
  warning: { edge: "border-l-[var(--warning)]", ground: "bg-[var(--warning-surface)]", ink: "text-[var(--warning-ink)]" },
  error: { edge: "border-l-[var(--error)]", ground: "bg-[var(--error-surface)]", ink: "text-[var(--error-ink)]" },
};

export function Callout({ tone, title, children, className }: { tone: Tone; title: ReactNode; children?: ReactNode; className?: string }) {
  const t = CALLOUT[tone];
  return (
    <div
      role={tone === "error" || tone === "warning" ? "note" : undefined}
      className={cn("rounded-[12px] border border-[var(--border)] border-l-[3px] px-4 py-3.5", t.edge, t.ground, className)}
    >
      <div className={cn("text-sm leading-[1.5] font-semibold tracking-[-0.02em]", t.ink)}>{title}</div>
      {children && <div className="mt-1.5 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{children}</div>}
    </div>
  );
}

/* ── card ───────────────────────────────────────────────────────────────── */

export function SettingsCard({
  title,
  sub,
  info,
  children,
  className,
  bodyClassName,
  pad = 24,
  action,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  /** Why the card exists, behind an (i) beside the title (owner, 2026-10-29). `sub` is for one line
   *  that must be read to use the card. */
  info?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  pad?: 18 | 20 | 24;
  action?: ReactNode;
}) {
  // Foundation v3: one card padding, 16px. `pad` is kept so no caller has to change.
  const p = { 18: "p-4", 20: "p-4", 24: "p-4" }[pad];
  return (
    <section className={cn("m-glass min-w-0 rounded-[12px] border border-[var(--border)]", p, className)}>
      {(title || sub || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <div className="flex min-w-0 items-center gap-1">
                <h3 className="m-0 text-card-title text-[var(--ink)]">{titleCaseNode(title)}</h3>
                {info && <InfoTip label={typeof title === "string" ? `About ${title.toLowerCase()}` : "About this card"}>{info}</InfoTip>}
              </div>
            )}
            {sub && <p className="mt-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children !== undefined && <div className={cn(title || sub ? "mt-4" : "", bodyClassName)}>{children}</div>}
    </section>
  );
}

/** The dashed card a section shows when the thing lives somewhere else, or does not exist yet. */
export function DashedCard({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="m-glass flex min-w-0 flex-col items-center rounded-[12px] border border-dashed border-[var(--border-strong)] p-5 text-center">
      {icon && (
        <span className="inline-flex size-[34px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]">{icon}</span>
      )}
      <div className="mt-2.5 text-card-title text-[var(--ink)]">{title}</div>
      {children && <p className="mt-1.5 max-w-[46ch] text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ── table card ─────────────────────────────────────────────────────────── */

export function SettingsTableCard({ title, actions, children, className, headerClassName }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; /** e.g. a see-through header on a glass card. */ headerClassName?: string }) {
  return (
    <section className={cn("m-glass flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)]", className)}>
      <div className={cn("m-glass-head flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3", headerClassName)}>
        <span className="text-card-title text-[var(--ink)]">{title}</span>
        {actions && <span className="flex flex-wrap items-center gap-2.5">{actions}</span>}
      </div>
      <div className="min-w-0 overflow-x-auto">{children}</div>
    </section>
  );
}

/** Table cell classes for the boards' tables (foundation v3): a 40px sentence-case head at 13/500, 44px rows. */
export const st = {
  table: "w-full border-collapse text-left",
  headRow: "m-glass-head",
  th: "h-[40px] px-3 py-2 text-label whitespace-nowrap text-[var(--muted)]",
  td: "h-[44px] border-t border-[var(--border)] px-3 py-2 align-middle text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]",
  num: "text-right tabular-nums",
  strong: "font-semibold text-[var(--ink)]",
  sub: "block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]",
  code: "font-mono text-sm text-[var(--ink)]",
};

/* ── pill ───────────────────────────────────────────────────────────────── */

// The tone map lives in lib/ui/pillTone.ts so server components can call it; re-exported for the
// client call sites that import it from here.
export { pillTone, type PillTone } from "@/lib/ui/pillTone";

/**
 * @deprecated UX-5: use `StatusChip` from components/ui/status-chip. A thin alias kept while its call
 * sites move; the ratchet counts them down. Unlike StatusChip, a Pill shows no dot unless asked.
 */
export function Pill({ tone = "neutral", dot, children, className }: { tone?: PillTone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <StatusChip tone={PILL_TONE[tone]} dot={dot ?? false} className={className}>
      {children}
    </StatusChip>
  );
}

/* ── fields ─────────────────────────────────────────────────────────────── */

// Moved to components/ui/field.tsx (foundation v3): every form uses them, not only Settings.
export { checkboxControl, control, Field, Switch, textareaControl, ToggleRow } from "@/components/ui/field";

/* ── key / value ────────────────────────────────────────────────────────── */

export function KeyValues({ items, cols = 2 }: { items: { label: ReactNode; value: ReactNode; tone?: "warning" | "error" }[]; cols?: 1 | 2 }) {
  return (
    <dl className={cn("m-0 grid gap-x-6 gap-y-4", cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs leading-[1.33] text-[var(--muted)]">{item.label}</dt>
          <dd
            className={cn(
              "m-0 mt-1 text-sm leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums break-words",
              item.tone === "warning" ? "text-[var(--warning-ink)]" : item.tone === "error" ? "text-[var(--error-ink)]" : "text-[var(--ink)]"
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── meter ──────────────────────────────────────────────────────────────── */

const METER_FILL = {
  primary: "bg-[var(--primary)]",
  muted: "bg-[var(--muted)]",
  warning: "bg-[var(--warning)]",
  error: "bg-[var(--error)]",
  success: "bg-[var(--success)]",
} as const;

/** 6px on the sunken track. `label`/`value` sit above it, `caption` below. */
export function SettingsMeter({
  value,
  max,
  tone = "primary",
  label,
  valueLabel,
  caption,
  ariaLabel,
}: {
  value: number;
  max: number;
  tone?: keyof typeof METER_FILL;
  label?: ReactNode;
  valueLabel?: ReactNode;
  caption?: ReactNode;
  ariaLabel: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="min-w-0">
      {(label || valueLabel) && (
        <div className="mb-[5px] flex justify-between gap-3 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">
          <span>{label}</span>
          <span>{valueLabel}</span>
        </div>
      )}
      <span
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="m-meter block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <span className={cn("block h-1.5 rounded-full", METER_FILL[tone])} style={{ width: `${pct}%` }} />
      </span>
      {caption && <div className="mt-1 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{caption}</div>}
    </div>
  );
}

/* ── timeline ───────────────────────────────────────────────────────────── */

export function Timeline({ items }: { items: { title: ReactNode; sub?: ReactNode; tone?: "primary" | "success" | "warning" | "error" | "muted" }[] }) {
  const dot = { primary: "bg-[var(--primary)]", success: "bg-[var(--success)]", warning: "bg-[var(--warning)]", error: "bg-[var(--error)]", muted: "bg-[var(--muted)]" };
  return (
    <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", dot[item.tone ?? "primary"])} />
          <span className="min-w-0">
            <span className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.title}</span>
            {item.sub && <span className="mt-0.5 block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{item.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlusIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
