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

export function FoldSection({ heading, done, total, complete, keepOpen = false, unit = "answered", progressLabel, completeLabel, footer, folded: foldedProp, onFoldedChange, children }: {
  /**
   * Controlled folding, for a section that folds whether or not it is finished (Submit's copy-assist,
   * owner 2026-10-29): the header always toggles it, and its parent can fold it (a Next button).
   */
  folded?: boolean;
  onFoldedChange?: (folded: boolean) => void;
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
  // Never fold under the agent's cursor (QA 2026-11-03: a section that folded as its last field was
  // filled swallowed what was being typed next): while focus is anywhere in its rows — a field, a
  // select, a chip — the section stays open, and it folds once focus leaves it.
  const [focused, setFocused] = useState(false);
  // A deep link to a field in here (Review's "Fix on Application", a pasted #field URL) opens it.
  const [asked, setAsked] = useState(false);
  const controlled = foldedProp !== undefined;
  const folded = controlled ? foldedProp : complete && !keepOpen && !reopened && !focused && !asked;
  const foldable = controlled || complete;
  const rows = Children.toArray(children);
  const id = `fold-${heading.toLowerCase().replace(/[^\w-]+/g, "-")}`;
  const ref = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Focus is read from the document, not only this section's own blur: a focused button that goes away
  // (a "Confirm" pressed) fires no blur, and the header button sits outside the rows on purpose.
  useEffect(() => {
    const check = () => setFocused(Boolean(body.current?.contains(document.activeElement)));
    const later = () => window.setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", later); };
  }, []);

  useEffect(() => {
    const open = (raw: unknown) => {
      const fieldId = typeof raw === "string" ? raw : "";
      if (!fieldId) return;
      const el = document.getElementById(fieldId);
      if (el && body.current?.contains(el)) setAsked(true);
    };
    const fromHash = () => open(decodeURIComponent(window.location.hash.slice(1)));
    const onField = (e: Event) => open((e as CustomEvent).detail);
    // The step holding the field mounts as the URL moves: check the hash now and once more after it settles.
    const t1 = window.setTimeout(fromHash, 0);
    const t2 = window.setTimeout(fromHash, 300);
    window.addEventListener("workspace:field", onField);
    window.addEventListener("hashchange", fromHash);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.removeEventListener("workspace:field", onField); window.removeEventListener("hashchange", fromHash); };
  }, []);

  // Finished just now (not already finished when the step opened): once it has folded, bring the next
  // section into view, so the agent is led on rather than left looking at a closed header (owner 2026-10-28).
  // Not when the agent is already in another field: the page does not move under them.
  const wasFolded = useRef(folded);
  useEffect(() => {
    if (folded && !wasFolded.current) {
      const t = window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body && !ref.current?.contains(active)) return;
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
        disabled={!foldable}
        onClick={() => {
          if (controlled) { onFoldedChange?.(!folded); return; }
          // Open → closed also lets go of a deep link's hold; closed → open holds it open.
          if (folded) setReopened(true);
          else { setReopened(false); setAsked(false); }
        }}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-[10px] px-3.5 py-2.5 text-left outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          complete ? "bg-[var(--primary-soft)] hover:bg-[color-mix(in_srgb,var(--primary)_18%,transparent)]" : "bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]",
        )}
      >
        {/* Owner 2026-10-28: the section names (Before we start, Health, Medications…) in the bright ink. */}
        <span className="text-xs font-semibold text-[var(--ink)]">{heading}</span>
        <span className="flex items-center gap-2">
          {complete
            ? <StatusChip tone="good" dot>{completeLabel ?? (total ? `Complete · ${done} of ${total}` : "Complete")}</StatusChip>
            : <StatusChip tone="neutral" dot>{progressLabel ?? (total ? `${done} of ${total} ${unit}` : "Nothing required")}</StatusChip>}
          {foldable && <ChevronDown aria-hidden="true" className={cn("size-4 text-[var(--muted)] transition-transform duration-300", !folded && "rotate-180")} />}
        </span>
      </button>
      {/* grid-rows 1fr → 0fr animates the real height; closing waits a beat so the last answer is seen. */}
      <div
        id={id}
        ref={body}
        inert={folded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
          folded ? "grid-rows-[0fr] opacity-0 delay-300" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {rows.length > 0 && (
            <div className="grid items-start gap-1.5 pt-1.5 md:grid-cols-2">
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
