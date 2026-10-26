import { Info } from "lucide-react";

/**
 * A one-line hint behind a small (i), shown on hover or keyboard focus and floating above the label
 * so nothing below it moves (owner, 2026-10-26: "not a card that pushes the form down"). For what a
 * field needs; longer explanations still use InfoTip.
 */
export function HoverHint({ id, label, children }: { id: string; label: string; children: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        onClick={(event) => event.currentTarget.focus()}
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[var(--accent-ink)] focus-visible:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
      >
        <Info className="size-4" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full -left-2 z-20 mb-1.5 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] px-3 py-2 text-xs font-normal leading-normal tracking-normal normal-case text-[var(--body)] opacity-0 shadow-[var(--shadow-overlay,0_12px_30px_rgba(0,0,0,.35))] transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
