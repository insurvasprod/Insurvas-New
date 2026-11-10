"use client";

import { Check, Minus } from "lucide-react";
import type { InputHTMLAttributes } from "react";

/**
 * The app's checkbox (owner 2026-11-08: "the checkboxes need a better design"): an 18px rounded square with
 * the brand fill and a tick when on, a dash when `mixed` (some of a list chosen). The real input stays
 * underneath, so labels, keyboard and forms work as they always did.
 */
export function CheckBox({ mixed = false, className = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { mixed?: boolean }) {
  const on = Boolean(props.checked) || mixed;
  return (
    <span className={`relative inline-grid size-[18px] shrink-0 place-items-center align-middle ${className}`}>
      <input
        type="checkbox"
        {...props}
        aria-checked={mixed ? "mixed" : props.checked}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px] border border-[color-mix(in_srgb,var(--foreground)_40%,transparent)] bg-transparent transition-colors checked:border-transparent checked:bg-primary hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
        style={mixed ? { background: "var(--primary)", borderColor: "transparent" } : undefined}
      />
      {on ? (mixed && !props.checked
        ? <Minus aria-hidden="true" className="m-tick pointer-events-none relative size-3 text-primary-foreground" strokeWidth={3} />
        : <Check aria-hidden="true" className="m-tick pointer-events-none relative size-3 text-primary-foreground" strokeWidth={3} />) : null}
    </span>
  );
}
