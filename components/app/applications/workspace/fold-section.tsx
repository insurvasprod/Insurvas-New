"use client";

/**
 * A section of a workspace step that folds once it is finished, like the call's verification panel
 * (LA-1.11-7; owner 2026-10-28). The header names the section and counts it ("2 of 5 answered", then
 * "Complete · 5 of 5"); a finished section closes after a beat (so the last answer is seen landing)
 * with a height animation, and a click on its header opens it again. Used by Verify and the interview.
 *
 * Its rows sit two to a line, split 50/50, read left to right; an odd last row takes the whole line.
 */

import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

export function FoldSection({ heading, done, total, complete, keepOpen = false, unit = "answered", progressLabel, completeLabel, footer, children }: {
  heading: string;
  done: number;
  total: number;
  /** Every row finished (and nothing in it that must stay on screen, like a knockout). */
  complete: boolean;
  /** Something in it was asked for (a fact on the client card, a Review fix): stay open. */
  keepOpen?: boolean;
  /** "answered" or "confirmed". */
  unit?: string;
  /** In place of "2 of 5 answered" / "Complete · 5 of 5", for a section that is not a list of questions. */
  progressLabel?: string;
  completeLabel?: string;
  /** Full width under the rows, inside the fold (a running total, an "add" button). */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const [reopened, setReopened] = useState(false);
  // Never fold under the agent's cursor: while they are typing in a field here, the section stays open
  // until they leave it ("Done", Enter, or a click elsewhere).
  const [typing, setTyping] = useState(false);
  const folded = complete && !keepOpen && !reopened && !typing;
  const isTyped = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type)));
  const rows = Children.toArray(children);
  const id = `fold-${heading.toLowerCase().replace(/[^\w-]+/g, "-")}`;

  // Finished just now (not already finished when the step opened): once it has folded, bring the next
  // section into view, so the agent is led on rather than left looking at a closed header (owner 2026-10-28).
  const ref = useRef<HTMLElement>(null);
  const wasFolded = useRef(folded);
  useEffect(() => {
    if (folded && !wasFolded.current) {
      const t = window.setTimeout(() => {
        let next = ref.current?.nextElementSibling ?? null;
        while (next && !(next instanceof HTMLElement && next.tagName === "SECTION")) next = next.nextElementSibling;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        (next as HTMLElement | null)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }, 850);
      wasFolded.current = folded;
      return () => window.clearTimeout(t);
    }
    wasFolded.current = folded;
  }, [folded]);

  return (
    <section ref={ref} aria-label={heading} className="flex scroll-mt-24 flex-col">
      <button
        type="button"
        aria-expanded={!folded}
        aria-controls={id}
        disabled={!complete}
        onClick={() => setReopened((r) => !r)}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-[10px] px-3.5 py-2.5 text-left outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          complete ? "bg-[var(--primary-soft)] hover:bg-[color-mix(in_srgb,var(--primary)_18%,transparent)]" : "bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]",
        )}
      >
        <span className="text-xs font-semibold tracking-[0.04em] text-[var(--body)] uppercase">{heading}</span>
        <span className="flex items-center gap-2">
          {complete
            ? <StatusChip tone="good" dot>{completeLabel ?? (total ? `Complete · ${done} of ${total}` : "Complete")}</StatusChip>
            : <StatusChip tone="neutral" dot>{progressLabel ?? (total ? `${done} of ${total} ${unit}` : "Nothing required")}</StatusChip>}
          {complete && <ChevronDown aria-hidden="true" className={cn("size-4 text-[var(--muted)] transition-transform duration-300", !folded && "rotate-180")} />}
        </span>
      </button>
      {/* grid-rows 1fr → 0fr animates the real height; closing waits a beat so the last answer is seen. */}
      <div
        id={id}
        inert={folded}
        onFocus={(e) => { if (isTyped(e.target)) setTyping(true); }}
        onBlur={(e) => { if (isTyped(e.target)) setTyping(false); }}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
          folded ? "grid-rows-[0fr] opacity-0 delay-300" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {rows.length > 0 && (
            <div className="grid gap-1.5 pt-1.5 md:grid-cols-2">
              {rows.map((row, i) => (
                <div key={i} className={cn("min-w-0", rows.length % 2 === 1 && i === rows.length - 1 && "md:col-span-2")}>{row}</div>
              ))}
            </div>
          )}
          {footer && <div className="pt-1.5">{footer}</div>}
        </div>
      </div>
    </section>
  );
}
