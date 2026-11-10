import type { RailStep, RailWaiting } from "@/components/app/step-frame/step-rail";

/**
 * What the shell's loading state needs to draw a merged page's frame before the page is here (2026-11-08, "feel
 * instant"). Every step of Accounting, Data in, Compliance, Commissions and Reports is its own route, so opening the
 * next one passes through the shell's loading state; with nothing to go on it drew a whole-page skeleton and the
 * title and the rail vanished for a second. Each rail remembers itself here as it renders (this tab only, in memory —
 * the server still decides what a person may open), and ShellLoading redraws the same rail and title around a
 * skeleton when the address it is loading is one of that rail's steps.
 */
export type RememberedRail = {
  label: string;
  cookie: string;
  countsUrl?: string;
  waiting?: RailWaiting;
  steps: RailStep[];
  foot?: { label: string; href: string } | null;
  collapsed: boolean;
};

const rails = new Map<string, RememberedRail>();
const counts = new Map<string, Record<string, number>>();
let reports: { collapsed: boolean } | null = null;

/** A rail as it is drawn now; the latest one wins where two rails share a page. */
export function rememberRail(rail: RememberedRail) {
  rails.delete(rail.cookie);
  rails.set(rail.cookie, rail);
}

/**
 * The rail whose step `pathname` is, latest first: `exact` when it is the step's own address (the title is the step's
 * name), otherwise a page under a step (a record — its title is unknown until it is here).
 */
export function railFor(pathname: string): { rail: RememberedRail; step: RailStep; exact: boolean } | null {
  const latest = [...rails.values()].reverse();
  for (const rail of latest) {
    const step = rail.steps.find((item) => item.href === pathname);
    if (step) return { rail, step, exact: true };
  }
  let best: { rail: RememberedRail; step: RailStep } | null = null;
  for (const rail of latest) {
    for (const step of rail.steps) {
      if (pathname.startsWith(`${step.href}/`) && (!best || step.href.length > best.step.href.length)) best = { rail, step };
    }
  }
  return best ? { ...best, exact: false } : null;
}

/** A rail's last badge counts, so a redrawn rail does not drop its badges while it asks again. */
export function rememberCounts(url: string, value: Record<string, number>) {
  counts.set(url, value);
}
export function countsFor(url: string | undefined): Record<string, number> {
  return (url && counts.get(url)) || {};
}

/**
 * Leads in (Source, Import, Review, Clean, Route, Recycle) draws its own menu (LeadsInRail), so it remembers itself
 * here too (2026-11-09): the steps it offered this person and whether it was collapsed. ShellLoading redraws the same
 * title and menu around a skeleton, as it does for the other merged pages.
 */
export type LeadsInFrame = { steps: Array<{ key: string; label: string; sub: string; href: string }>; collapsed: boolean };
let leadsIn: LeadsInFrame | null = null;
export function rememberLeadsIn(frame: LeadsInFrame) {
  leadsIn = frame;
}
/** The Leads in step `pathname` is (or a page under one), with whether it is the step's own address. */
export function leadsInFor(pathname: string): { frame: LeadsInFrame; step: LeadsInFrame["steps"][number]; exact: boolean } | null {
  if (!leadsIn) return null;
  const step = leadsIn.steps.find((item) => item.href === pathname);
  if (step) return { frame: leadsIn, step, exact: true };
  const under = leadsIn.steps.filter((item) => pathname.startsWith(`${item.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return under ? { frame: leadsIn, step: under, exact: false } : null;
}

/** The Reports menu filters its own views from the shell's menu; all it needs remembered is whether it is collapsed. */
export function rememberReports(collapsed: boolean) {
  reports = { collapsed };
}
export function reportsFrame(): { collapsed: boolean } | null {
  return reports;
}
