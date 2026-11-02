"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Choice<K extends string> = { key: K; label: string; hint?: string; disabled?: boolean; children?: ReactNode };

/**
 * The choices of a Needs you item, as radios: one line each, a short hint under it, and what that choice
 * needs (a client to pick, a reason) opening under the chosen one.
 */
export function ChoiceList<K extends string>({ name, label, choices, value, onChange, disabled = false }: { name: string; label: string; choices: ReadonlyArray<Choice<K>>; value: K | null; onChange: (key: K) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
      {choices.map((choice) => {
        const on = choice.key === value;
        const off = disabled || Boolean(choice.disabled);
        return (
          <div key={choice.key} className={cn("flex flex-col gap-2 rounded-lg border p-3 transition-colors", on ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-[var(--border)]", off && !on && "opacity-60")}>
            <label className={cn("flex items-start gap-3", off ? "cursor-not-allowed" : "cursor-pointer")}>
              <input type="radio" name={name} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={on} disabled={off} onChange={() => onChange(choice.key)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)]">{choice.label}</span>
                {choice.hint && <span className="block text-xs leading-[1.5] text-[var(--muted)]">{choice.hint}</span>}
              </span>
            </label>
            {on && choice.children && <div className="pl-7">{choice.children}</div>}
          </div>
        );
      })}
    </div>
  );
}
