import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { StepRail, type RailStep, type RailWaiting } from "@/components/app/step-frame/step-rail";
import { FRAME_HEADER, StepFrameLayout } from "@/components/app/step-frame/step-frame-layout";

/**
 * The frame of a merged page (Data in and Accounting, 2026-11-02; the Compliance and Reports layout): the
 * page's title and trail across the top; then the rail standing the full height on the left and, on the
 * right, the step's own row (`tabs`: its sub-page bar; `actions`: its one primary) over the step, which scrolls
 * inside itself so every part of it is reachable without the page moving.
 *
 * The caller decides which steps this person may open — each by the rule its own route applies — and
 * reads the rail's collapsed cookie; this only draws.
 */
export function StepFrame({ title, titleInfo, meta, rail, tabs, actions, breadcrumbs, children }: {
  title: string;
  /** A record's own trail when its parent is a record too (a row: Files › its file › Row N); else the page trail. */
  breadcrumbs?: Crumb[];
  /** An (i) beside the title, for a word the page cannot do without (Statements: what a carrier statement is). */
  titleInfo?: ReactNode;
  /** One quiet line under the title: a record's facts on a detail page (round 3, owner 2026-11-02). */
  meta?: ReactNode;
  rail: { label: string; cookie: string; countsUrl?: string; waiting?: RailWaiting; steps: RailStep[]; step: string; collapsed: boolean; foot?: { label: string; href: string } | null };
  /** The step's sub-pages or views: the sub-page bar under the title, over the step (owner 2026-11-09). */
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // The step's buttons are on the title's line; its tabs are the sub-page bar on their own row, starting on the
  // step's left edge (owner 2026-11-09, UI-CONSISTENCY §8).
  // The grid is StepFrameLayout's, shared with the loading state (ShellLoading), so opening another step redraws the
  // title and the rail exactly where they were and only the step's column changes (2026-11-08).
  return (
    <StepFrameLayout
      stepKey={rail.step}
      header={<PageHeader title={title} titleInfo={titleInfo} meta={meta} tabs={tabs} actions={actions} breadcrumbs={breadcrumbs} className={FRAME_HEADER} />}
      rail={<StepRail label={rail.label} cookie={rail.cookie} countsUrl={rail.countsUrl} waiting={rail.waiting} steps={rail.steps} step={rail.step} initialCollapsed={rail.collapsed} foot={rail.foot} />}
    >
      {children}
    </StepFrameLayout>
  );
}
