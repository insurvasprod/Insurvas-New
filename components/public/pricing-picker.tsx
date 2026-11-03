"use client";

import { ArrowRight, Check, Sparkles } from "lucide-react";

import type { FitNeed, FitResult } from "@/lib/pricing/planFit";

/**
 * "Which plan fits you?" (2026-10-13 pricing). The questions are jobs, each mapped to catalog
 * modules in lib/pricing/planFit.ts; the answer is the cheapest plan that covers every job ticked,
 * which the page then highlights on its card.
 */
export function PricingPicker({ needs, selected, onToggle, result, onShow }: { needs: FitNeed[]; selected: string[]; onToggle: (id: string) => void; result: FitResult; onShow: (code: string) => void }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-rest)] sm:p-7">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <h2 className="text-title-sm font-semibold tracking-[-0.015em] text-foreground">Which plan fits you?</h2>
        <p className="text-sm text-muted-foreground">Tick what you do. We will point at the plan.</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {needs.map((need) => {
          const on = selected.includes(need.id);
          return (
            <button
              key={need.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(need.id)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-left text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,transform] duration-200 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
                on ? "border-transparent bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-border bg-card text-[var(--body)] hover:border-[var(--border-strong)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-200 ${on ? "bg-[var(--primary)] text-[var(--on-primary)]" : "border border-[var(--border-strong)]"}`}
              >
                {on ? <Check className="size-3 stroke-[3]" /> : null}
              </span>
              {need.label}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-4 min-h-6">
        {result.status === "match" ? (
          <div key={`${result.code}-${result.reason}`} className="pz-swap flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm leading-normal text-[var(--body)]">
              <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
              <span>
                <span className="font-semibold text-foreground">{result.name} fits.</span> {result.reason}
              </span>
            </p>
            <button
              type="button"
              onClick={() => onShow(result.code)}
              className="inline-flex shrink-0 items-center gap-1.5 self-start text-sm font-semibold text-[var(--accent-ink)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] sm:self-auto"
            >
              See {result.name}
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : result.status === "none" ? (
          <p key="none" className="pz-swap text-sm text-[var(--body)]">{result.reason}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing ticked yet. Pick one or more and the matching plan lights up below.</p>
        )}
      </div>
    </div>
  );
}
