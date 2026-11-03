/**
 * The one Leads page's six steps (owner pick B, 2026-10-28; components/app/lead-sources/leads-in.tsx).
 * A plain module so the server frame, the client rail and the top bar's crumb all read one list.
 */
/** The Lead sources menu collapsed or open, remembered for a year; the frame reads it on the server so the page draws at the right width. */
export const RAIL_COOKIE = "insurvas_leadsin_rail";

export type LeadsInStep = "source" | "import" | "review" | "clean" | "lists" | "route" | "recycle";

export const LEADS_IN_STEPS: { key: LeadsInStep; label: string; sub: string; href: string }[] = [
  { key: "source", label: "Source", sub: "Campaigns and their lists", href: "/app/campaigns" },
  { key: "import", label: "Import", sub: "Drop the vendor's file", href: "/app/import" },
  // Owner 2026-10-28: a staged file's review is a step of its own, between the upload and the duplicate
  // check. Its address is the file's (/app/import/review/<batch>); the rail learns the latest one live.
  { key: "review", label: "Review", sub: "Check the file", href: "/app/import" },
  { key: "clean", label: "Clean", sub: "Duplicates and missing data", href: "/app/duplicates" },
  // No Lists page (manager 2026-10-29): a campaign holds its lists, on Source (/app/campaigns/<id>).
  { key: "route", label: "Route", sub: "Who calls which leads", href: "/app/assignments" },
  { key: "recycle", label: "Recycle", sub: "Call them again", href: "/app/nurture" },
];

/** Each step's own address; a file's review (/app/import/review/…) is Review. Not the list detail pages. */
const STEP_PATHS: [RegExp, LeadsInStep][] = [
  // A campaign and its lists are Source too (/app/campaigns/<id>, /app/campaigns/<id>/lists/<batch>).
  [/^\/app\/campaigns(\/|$)/, "source"],
  [/^\/app\/import\/review\//, "review"],
  [/^\/app\/import\/?$/, "import"],
  [/^\/app\/duplicates\/?$/, "clean"],
  [/^\/app\/(lead-sources|lead-lists)(\/|$)/, "source"],
  [/^\/app\/(assignments|lead-routing)\/?$/, "route"],
  [/^\/app\/nurture\/?$/, "recycle"],
];

export function leadsInStepOf(pathname: string): LeadsInStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function leadsInStepLabel(step: LeadsInStep): string {
  return LEADS_IN_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** What the rail says under a step once its live count is in (the step's `sub` until then, or on a failed read). */
export function leadsInStepStatus(step: LeadsInStep, n: number): { text: string; needsYou: boolean } {
  const many = n.toLocaleString("en-US");
  switch (step) {
    case "source": return { text: n === 0 ? "No active campaigns" : `${many} active campaign${n === 1 ? "" : "s"}`, needsYou: n === 0 };
    case "import": return { text: "Drop the vendor's file", needsYou: false };
    case "review": return n > 0 ? { text: `${many} waiting for review`, needsYou: true } : { text: "Nothing to review", needsYou: false };
    case "clean": return n > 0 ? { text: `${many} to confirm`, needsYou: true } : { text: "Nothing to confirm", needsYou: false };
    case "lists": return n > 0 ? { text: `${many} can't be dialed yet`, needsYou: true } : { text: "Every list can be dialed", needsYou: false };
    case "route": return n > 0 ? { text: `${many} waiting for someone`, needsYou: true } : { text: "Nobody waiting", needsYou: false };
    case "recycle": return n > 0 ? { text: `${many} in nurture`, needsYou: false } : { text: "Nothing to recycle", needsYou: false };
  }
}
