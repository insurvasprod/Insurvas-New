"use client";

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { titleCaseNode } from "@/components/ui/title-case";

/**
 * The chip a person presses (foundation v3, 2026-10-27): pick one of a few choices, switch a choice
 * on or off, or remove an applied value. `StatusChip` shows a state and cannot be pressed; this can.
 * One size everywhere (owner 2026-10-30, the Source tabs): 36px tall like every control beside it, 14px
 * semibold text, 6px corners. `count` draws the number after the label in its own small badge.
 *
 *   selected   the choice is on: the soft green ground and a tick.
 *   onRemove   draws an × after the label and makes the whole chip remove the value.
 *
 * Several chips that pick one value sit in a `role="radiogroup"` the caller names; chips that each
 * switch on or off use `aria-pressed`, which this sets.
 */
export function ToggleChip({
  selected = false,
  onClick,
  onRemove,
  disabled = false,
  role,
  count,
  countTone,
  children,
  className,
}: {
  /** How many rows the choice holds, drawn after the label ("Live 22"). */
  count?: number | string;
  /** The count in a state colour when the number itself is the warning ("Overdue 4"). */
  countTone?: "danger" | "warning";
  selected?: boolean;
  onClick?: () => void;
  /** A removable value: the chip removes it when pressed. */
  onRemove?: () => void;
  disabled?: boolean;
  /** "radio" inside a radiogroup; otherwise the chip is a toggle button. */
  role?: "radio";
  children: ReactNode;
  /** Layout only. */
  className?: string;
}) {
  const removable = Boolean(onRemove);
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "radio" ? selected : undefined}
      aria-pressed={role === "radio" || removable ? undefined : selected}
      aria-label={removable && typeof children === "string" ? `Remove ${children}` : undefined}
      disabled={disabled}
      onClick={removable ? onRemove : onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm font-semibold tracking-[-0.01em] transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-transparent bg-[var(--primary-soft)] text-[var(--accent-ink)]"
          : "border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_55%,transparent)] text-[var(--body)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]",
        className,
      )}
    >
      {selected && !removable && <Check className="size-3.5" aria-hidden="true" />}
      {titleCaseNode(children)}
      {count !== undefined && (
        <span className={cn(
          "rounded-badge px-1.5 text-xs tabular-nums",
          countTone === "danger" ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : countTone === "warning" ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--surface-alt)] text-[var(--ink)]",
        )}>{count}</span>
      )}
      {removable && <X className="size-3.5 opacity-70" aria-hidden="true" />}
    </button>
  );
}
