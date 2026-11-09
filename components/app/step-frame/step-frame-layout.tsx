import type { ReactNode } from "react";

/**
 * The grid of a merged page (StepFrame, the Reports frame) and of its loading state (ShellLoading), in one place so
 * the two are the same to the pixel: when a step is opened, the title and the rail are drawn where they already were
 * and only the step's column changes (2026-11-08, "feel instant").
 *
 * No hooks, no server imports: the server frames and the client loading state both draw it.
 */
// One column on a phone (minmax(0,1fr), so the rail's chip row scrolls instead of widening the page).
export const FRAME_GRID = "grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[min-content_minmax(0,1fr)] lg:gap-y-0";
export const FRAME_RAIL_CELL = "lg:col-start-1 lg:row-start-2 lg:min-h-0";
export const FRAME_STEP_CELL = "flex min-w-0 flex-col lg:col-start-2 lg:row-start-2 lg:min-h-0";
// Its blocks keep their height (a strip is never squeezed); the column scrolls, never the page. `data-page-content`
// is what dims while the next step is on its way, and `m-content-in` the one 150ms arrival (globals.css).
export const FRAME_STEP = "flex min-w-0 flex-col gap-4 [&>*]:shrink-0 m-content-in lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1";
/** The header's place in the grid: across both columns, 24px over the rail and the step. */
export const FRAME_HEADER = "lg:col-span-2 lg:pb-6";

/** Rail on the left, the step on the right, `header` across the top. `stepKey` replays the arrival per step. */
export function StepFrameLayout({ header, rail, stepKey, busy = false, children }: {
  header: ReactNode;
  rail: ReactNode;
  stepKey: string;
  /** The loading state: the step's column says it is busy. */
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-step-frame className={FRAME_GRID}>
      {header}
      <div className={FRAME_RAIL_CELL}>{rail}</div>
      <div className={FRAME_STEP_CELL}>
        <div key={stepKey} data-page-content aria-busy={busy || undefined} className={FRAME_STEP}>
          {children}
        </div>
      </div>
    </div>
  );
}
