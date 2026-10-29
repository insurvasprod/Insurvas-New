"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { titleCaseNode } from "@/components/ui/title-case";

/**
 * Form fields, once (foundation v3, 2026-10-27): the labelled field, the 36px control class, the
 * switch and the toggle row. They were the settings boards' own parts; every form in the product
 * uses them now, and `components/app/settings/primitives.tsx` re-exports them so its callers change
 * nothing. Labels are 13/500 (`text-label`), hints and errors 12px.
 */

/** The control without the gap above it, for a control whose label wraps it or sits elsewhere. */
export const inputControl =
  "box-border h-9 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-base md:text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

/** 36px, 14px type (16px on phones, so iOS does not zoom), strong edge: the same height as a Button and the shared Input (UI standard §5, 2026-09-28). */
export const control = `mt-1.5 ${inputControl}`;

/**
 * A `<label>` that wraps its text and its control, stacked: the 13/500 label step over the control
 * (foundation v3). For the boards that write `<label className={fieldLabel}>Text<select … /></label>`;
 * `Field` is the same with a hint and an error line.
 */
export const fieldLabel = "flex min-w-0 flex-col gap-1.5 text-label text-[var(--body)]";

/** A multi-line control: the same edge, corners and type as `control`. */
export const textareaControl = cn(control, "h-auto min-h-20 py-2");

/** The 16px checkbox with 4px corners (v3), in the brand green when ticked. */
export const checkboxControl =
  "size-4 shrink-0 cursor-pointer rounded-[4px] border border-[var(--border-strong)] accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60";

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
      <label htmlFor={htmlFor} className="text-label text-[var(--body)]">
        {titleCaseNode(label)}
        {required && <span className="text-[var(--error-ink)]"> *</span>}
      </label>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{hint}</span>
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
        <label htmlFor={id} className="block text-label text-[var(--body)]">{titleCaseNode(title)}</label>
        {help && <span className="mt-1 block max-w-[420px] text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{help}</span>}
      </span>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** The bare 38×22 switch, for a table cell or anywhere the label sits elsewhere. */
export function Switch({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** The accessible name when no <label> points at it. */
  label?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "justify-end bg-[var(--success)]" : "justify-start bg-[var(--border-strong)]"
      )}
    >
      <span className="size-[18px] rounded-full bg-[var(--surface)] shadow-[var(--shadow-rest)]" />
    </button>
  );
}

