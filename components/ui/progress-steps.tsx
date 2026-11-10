"use client";

/**
 * A short task in steps, drawn as a progress bar (owner 2026-11-08): one track per step across the full
 * width — filled for the steps done and the one you are on, empty for the steps ahead — with the step's
 * number and name under it. A done step can be reopened. Use it for a flow walked once per visit (Run
 * payroll: month → draft → record), never as navigation tabs.
 */
export type ProgressStep<K extends string> = { key: K; label: string };

export function ProgressSteps<K extends string>({ steps, current, onSelect, label }: {
  steps: ReadonlyArray<ProgressStep<K>>;
  current: K;
  /** Called for a step already done; steps ahead are not clickable. */
  onSelect?: (key: K) => void;
  label: string;
}) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <nav aria-label={label} className="min-w-0 flex-1">
      <ol className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const done = i < at;
          const now = i === at;
          const body = (
            <>
              <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <span className={`block h-full rounded-full transition-[width] duration-300 ${done || now ? "w-full bg-primary" : "w-0"}`} />
              </span>
              <span className="mt-2 flex min-w-0 items-baseline gap-1.5">
                <span className={`text-xs tabular-nums ${now || done ? "text-[var(--accent-ink)]" : "text-muted-foreground"}`}>{done ? "Done" : `Step ${i + 1}`}</span>
                <span className={`truncate text-sm ${now ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
              </span>
            </>
          );
          return (
            <li key={s.key} className="min-w-0" aria-current={now ? "step" : undefined}>
              {done && onSelect
                ? <button type="button" className="block w-full rounded-md text-left hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" onClick={() => onSelect(s.key)}>{body}</button>
                : <span className="block">{body}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
