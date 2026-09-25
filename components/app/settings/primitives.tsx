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

import { cn } from "@/lib/utils";

/* ── section header ─────────────────────────────────────────────────────── */

type SectionMeta = { title: string; description: string };
const SectionContext = createContext<SectionMeta | null>(null);

export function SettingsSectionProvider({ value, children }: { value: SectionMeta; children: ReactNode }) {
  return <SectionContext.Provider value={value}>{children}</SectionContext.Provider>;
}

/**
 * The 18px title, the one-line purpose, and — only where the section really holds a draft — the
 * Discard / Save pair. Sections that save each edit as it is made pass no actions: a Save button
 * with nothing pending behind it is a control that lies.
 */
export function SettingsSectionHeader({ actions }: { actions?: ReactNode }) {
  const meta = useContext(SectionContext);
  if (!meta) return null;
  return (
    // Wraps only on narrow screens. At desktop width the board keeps the pair on the right however
    // long the purpose line runs, so the text takes what is left rather than pushing them under it.
    <div className="flex flex-wrap items-end justify-between gap-6 lg:flex-nowrap">
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{meta.title}</h2>
        <p className="mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{meta.description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** Discard + Save changes, 40px, wired to a section's own draft. */
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
      <button type="button" className={btn("ghost")} onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </button>
      <button type="button" className={btn("primary")} onClick={onSave} disabled={!dirty || saving || disabled}>
        {saving ? "Saving…" : saveLabel}
      </button>
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
  "inline-flex items-center justify-center gap-2 rounded-[8px] border px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const BTN: Record<BtnKind, string> = {
  primary: "h-10 border-transparent bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--accent-hover)]",
  ghost: "h-10 border-transparent bg-transparent text-[var(--ink)] hover:bg-[var(--surface-alt)]",
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
      <div className={cn("text-[14px] leading-[1.5] font-semibold tracking-[-0.02em]", t.ink)}>{title}</div>
      {children && <div className="mt-1.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{children}</div>}
    </div>
  );
}

/* ── card ───────────────────────────────────────────────────────────────── */

export function SettingsCard({
  title,
  sub,
  children,
  className,
  bodyClassName,
  pad = 24,
  action,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  pad?: 18 | 20 | 24;
  action?: ReactNode;
}) {
  const p = { 18: "p-[18px]", 20: "p-5", 24: "p-6" }[pad];
  return (
    <section className={cn("min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]", p, className)}>
      {(title || sub || action) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && <h3 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h3>}
            {sub && <p className="mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</p>}
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
    <div className="flex min-w-0 flex-col items-center rounded-[12px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-5 text-center">
      {icon && (
        <span className="inline-flex size-[34px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)]">{icon}</span>
      )}
      <div className="mt-2.5 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</div>
      {children && <p className="mt-1.5 max-w-[46ch] text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ── table card ─────────────────────────────────────────────────────────── */

export function SettingsTableCard({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
        <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</span>
        {actions && <span className="flex flex-wrap items-center gap-2.5">{actions}</span>}
      </div>
      <div className="min-w-0 overflow-x-auto">{children}</div>
    </section>
  );
}

/** Table cell classes for the boards' tables: 12px uppercase heads, 14px body, 8×12 cells. */
export const st = {
  table: "w-full border-collapse text-left",
  headRow: "bg-[var(--surface-alt)]",
  th: "px-3 py-2 text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase whitespace-nowrap text-[var(--muted)]",
  td: "border-t border-[var(--border)] px-3 py-2 align-middle text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]",
  num: "text-right tabular-nums",
  strong: "font-semibold text-[var(--ink)]",
  sub: "block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]",
  code: "font-mono text-[13px] text-[var(--ink)]",
};

/* ── pill ───────────────────────────────────────────────────────────────── */

export type PillTone = "success" | "warning" | "error" | "info" | "neutral" | "brand";
const PILL: Record<PillTone, { ground: string; ink: string; dot: string }> = {
  success: { ground: "bg-[var(--success-surface)]", ink: "text-[var(--success-ink)]", dot: "bg-[var(--success)]" },
  warning: { ground: "bg-[var(--warning-surface)]", ink: "text-[var(--warning-ink)]", dot: "bg-[var(--warning)]" },
  error: { ground: "bg-[var(--error-surface)]", ink: "text-[var(--error-ink)]", dot: "bg-[var(--error)]" },
  info: { ground: "bg-[var(--info-surface)]", ink: "text-[var(--info-ink)]", dot: "bg-[var(--info)]" },
  neutral: { ground: "bg-[var(--surface-alt)]", ink: "text-[var(--body)]", dot: "bg-[var(--muted)]" },
  brand: { ground: "bg-[var(--brand-50)]", ink: "text-[var(--accent-ink)]", dot: "bg-[var(--primary)]" },
};

export function Pill({ tone = "neutral", dot, children, className }: { tone?: PillTone; dot?: boolean; children: ReactNode; className?: string }) {
  const t = PILL[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] whitespace-nowrap",
        t.ground,
        t.ink,
        className
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

/* ── fields ─────────────────────────────────────────────────────────────── */

/** 44px, 16px type, strong edge: the boards' one control height. */
export const control =
  "mt-1.5 box-border h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("block min-w-0", className)}>
      <label htmlFor={htmlFor} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">
        {label}
        {required && <span className="text-[var(--error-ink)]"> *</span>}
      </label>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{hint}</span>
      )}
    </div>
  );
}

/** Title + help on the left, a 38×22 switch on the right. */
export function ToggleRow({
  id,
  title,
  help,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  title: ReactNode;
  help?: ReactNode;
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <label htmlFor={id} className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{title}</label>
        {help && <span className="mt-1 block max-w-[420px] text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{help}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          "inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "justify-end bg-[var(--success)]" : "justify-start bg-[var(--border-strong)]"
        )}
      >
        <span className="size-[18px] rounded-full bg-[var(--surface)] shadow-[var(--shadow-rest)]" />
      </button>
    </div>
  );
}

/* ── key / value ────────────────────────────────────────────────────────── */

export function KeyValues({ items, cols = 2 }: { items: { label: ReactNode; value: ReactNode; tone?: "warning" | "error" }[]; cols?: 1 | 2 }) {
  return (
    <dl className={cn("m-0 grid gap-x-6 gap-y-4", cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{item.label}</dt>
          <dd
            className={cn(
              "m-0 mt-1 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums break-words",
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
        <div className="mb-[5px] flex justify-between gap-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">
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
      {caption && <div className="mt-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{caption}</div>}
    </div>
  );
}

/* ── stat tile ──────────────────────────────────────────────────────────── */

export function StatTile({ label, value, foot, tone }: { label: ReactNode; value: ReactNode; foot?: ReactNode; tone?: "warning" }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4">
      <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums",
          tone === "warning" ? "text-[var(--warning-ink)]" : "text-[var(--ink)]"
        )}
      >
        {value}
      </div>
      {foot && <div className="mt-1.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{foot}</div>}
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
            <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.title}</span>
            {item.sub && <span className="mt-0.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{item.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── search box (client-side filter) ────────────────────────────────────── */

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <span className="relative inline-flex w-[248px] max-w-full">
      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pointer-events-none absolute top-[12px] left-3 text-[var(--muted)]">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.2-3.2" />
      </svg>
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pr-3 pl-9 text-[14px] tracking-[-0.02em] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      />
    </span>
  );
}

/** A toolbar box inside a table card's bar: search on the left, the primary action on the right. */
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">{children}</div>;
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
