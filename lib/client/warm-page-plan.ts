/**
 * What the page on screen loads ahead (owner 2026-11-12: "load every button, sub-page … that we're seeing on this page,
 * after the first page has opened"): its tabs, its step rail, its title-line buttons, then its other button-links, so
 * the next click lands on a page that is already here. components/app/warm-page.tsx collects the links and runs this;
 * lib/client/warm-queue.ts loads them one at a time. Pure, so the rules are tested in Node (warmPage.test.mjs).
 *
 * Never a table's rows (a list of 50 records is not "what you are about to click"), never this page itself, never a
 * page that acts just by being opened, and at most WARM_PAGE_MAX a page.
 */

/** Where on the page a link sits; the order is the order they are loaded in. */
export type WarmRegion = "tabs" | "rail" | "header" | "body";
export type WarmCandidate = { href: string; region: WarmRegion; inRow?: boolean; optOut?: boolean };

export const WARM_PAGE_MAX = 16;
/** Wait this long after a page opens before loading what it links to: its own entrance and reads go first. */
export const WARM_PAGE_START_MS = 900;
/** Between two of the page's links. */
export const WARM_PAGE_GAP_MS = 400;
/** A page's later sections stream in after it opens: look again this often, this many times, for links that came with them. */
export const WARM_PAGE_RESCAN_MS = 1_500;
export const WARM_PAGE_RESCANS = 3;

const ORDER: Record<WarmRegion, number> = { tabs: 0, rail: 1, header: 2, body: 3 };
const PORTALS = /^\/(app|admin|partner)(\/|$|\?)/;

/**
 * Pages that do something just by being opened, or are not pages: a disposition walk starts its walk, the dialer serves
 * the next lead, a number check bills a lookup, an export or a print builds a file, and the API and sign-out are not
 * screens at all (browser-pass memory, 2026-09-24).
 */
const NEVER = [/\/disposition(\/|$|\?)/, /^\/app\/dialer(\/|$|\?)/, /\/check(\/|$|\?)/, /\/print(\/|$|\?)/, /\/export(\/|$|\?)/, /\/download(\/|$|\?)/, /^\/api\//, /\/(logout|sign-out|signout|login)(\/|$|\?)/];

/** The address as the router keys it: path and query, no origin, no hash. Null for anything that is not one of ours. */
export function warmable(href: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  const path = `${url.pathname}${url.search}`;
  if (!PORTALS.test(path)) return null;
  if (NEVER.some((rule) => rule.test(path))) return null;
  return path;
}

/**
 * The links to load ahead, in order, once each: tabs, then the rail, then the title line, then the page's buttons. A tab
 * is a view of its own (`?view=queue`); anywhere else, links to one page with other filters (a chart's twelve months
 * of Policies) are that page once — the first link to it is loaded, the rest open on it.
 */
export function warmPagePlan(candidates: readonly WarmCandidate[], here: string, origin: string): string[] {
  const seen = new Set<string>([here]);
  const pages = new Set<string>([here.split("?")[0]]);
  return candidates
    .map((candidate, index) => ({ ...candidate, index, path: candidate.optOut || candidate.inRow ? null : warmable(candidate.href, origin) }))
    .filter((candidate): candidate is typeof candidate & { path: string } => candidate.path !== null)
    .sort((a, b) => ORDER[a.region] - ORDER[b.region] || a.index - b.index)
    .flatMap((candidate) => {
      const page = candidate.path.split("?")[0];
      if (seen.has(candidate.path) || (candidate.region !== "tabs" && pages.has(page))) return [];
      seen.add(candidate.path);
      pages.add(page);
      return [candidate.path];
    })
    .slice(0, WARM_PAGE_MAX);
}
