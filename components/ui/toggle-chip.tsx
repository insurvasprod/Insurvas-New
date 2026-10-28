"use client";

import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The chip a person presses (foundation v3, 2026-10-27): pick one of a few choices, switch a choice
 * on or off, or remove an applied value. `StatusChip` shows a state and cannot be pressed; this can.
 * Same shape as the badge (6px corners), 28px tall so it is a fair target.
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
  children,
  className,
}: {
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
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-badge border px-2.5 text-xs font-medium tracking-[-0.01em] transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-transparent bg-[var(--primary-soft)] text-[var(--accent-ink)]"
          : "border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_55%,transparent)] text-[var(--body)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]",
        className,
      )}
    >
      {selected && !removable && <Check className="size-3.5" aria-hidden="true" />}
      {children}
      {removable && <X className="size-3.5 opacity-70" aria-hidden="true" />}
    </button>
  );
}
