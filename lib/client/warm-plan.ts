import type { SidebarTree } from "../menu/sidebar";

/**
 * What the app loads ahead after sign-in (2026-11-12, "every page opens instantly"; components/app/warm-app.tsx runs
 * it). Pure, so the rules are tested in Node (lib/design/warmApp.test.mjs).
 *
 * - **Frames:** every page the sidebar shows this person — its rail links and a merged group's steps, all already
 *   filtered by the server for plan, role and hidden pages. `router.prefetch` brings a dynamic page's code and its
 *   frame down to its loading state (the area frames, components/app/area-loading.tsx).
 * - **Data:** the most-used pages, and only those the same menu holds: Dashboard, Leads, Callbacks, the Dialer's
 *   queue, Policies, and the first Reports view this person has.
 *
 * Never anything the menu does not hold: a page the reader cannot open is never asked for.
 */

/** At most this many frames per sign-in (an owner on every module has 59 pages on the menu). */
export const WARM_FRAMES_MAX = 64;
/** At most this many pages' data per sign-in (the owner's pick: the 5–6 most used). */
export const WARM_DATA_MAX = 6;
/** Wait this long after the first page is up before starting, so its own reads go first. */
export const WARM_START_MS = 2_000;
/** Between two frames, and between two pages' data: one thing at a time, with room for the reader's own clicks. */
export const WARM_FRAME_GAP_MS = 300;
export const WARM_DATA_GAP_MS = 2_000;

/** The most-used pages whose data is loaded ahead, in order. `reports` is the first Reports view on this menu. */
export const WARM_DATA_PAGES = ["/app/dashboard", "/app/leads", "/app/callbacks", "/app/dialer", "/app/policies", "reports"] as const;

/**
 * Every page the sidebar shows this person, once each: the rail's own links in its order (Home, the groups,
 * Settings), then the steps a merged group lists on hover, so a cap would cut the least likely first.
 */
export function menuDestinations(tree: SidebarTree): string[] {
  const items = [...tree.home, ...tree.groups.flatMap((group) => group.items), ...tree.settings, ...tree.groups.flatMap((group) => group.steps ?? [])];
  return [...new Set(items.map((item) => item.path))];
}

/** The pages to load ahead for this menu, leaving out `here` (already on screen). */
export function warmPlan(tree: SidebarTree, here: string): { frames: string[]; data: string[] } {
  const destinations = menuDestinations(tree);
  const frames = destinations.filter((path) => path !== here).slice(0, WARM_FRAMES_MAX);
  const reports = tree.groups.find((group) => group.label === "Reports")?.items[0]?.path ?? null;
  const data = WARM_DATA_PAGES
    .map((page) => (page === "reports" ? reports : page))
    .filter((path): path is string => path !== null && path !== here && destinations.includes(path))
    .slice(0, WARM_DATA_MAX);
  return { frames, data };
}

/** A connection where loading ahead costs the reader: data saver on, or 2G. */
export function isSlowConnection(connection: { saveData?: boolean; effectiveType?: string } | undefined): boolean {
  if (!connection) return false;
  return connection.saveData === true || /(^|-)2g$/.test(connection.effectiveType ?? "");
}
