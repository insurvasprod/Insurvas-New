"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type { MenuSection } from "@/lib/menu/definition";
import { buildSidebarTree } from "@/lib/menu/sidebar";
import { ROUTE_RESOURCES, prefetchRoute } from "@/lib/client/route-resources";
import { peek } from "@/lib/client/resource-cache";
import { markWarmed, pageWarmIdle, recentlyWarmed } from "@/lib/client/warm-queue";
import { WARM_DATA_GAP_MS, WARM_FRAME_GAP_MS, WARM_START_MS, isSlowConnection, warmPlan } from "@/lib/client/warm-plan";

/**
 * Loads the app ahead after sign-in (2026-11-12, "every page opens instantly"), so a click on the menu lands on a
 * page that is already here. What is loaded is lib/client/warm-plan.ts; this runs it, gently:
 *
 * - Only once the first page is up and the browser is idle (`requestIdleCallback`, after hydration).
 * - One thing at a time, with a gap after each; paused while the tab is hidden; never on data saver or 2G.
 * - Frames first (`router.prefetch`: code and the area's loading frame, no page data), then the data of the
 *   most-used pages: a page that reads in the browser warms its reads (`prefetchRoute`, the same keys the page
 *   asks for), a page drawn on the server is fetched whole (a full prefetch, as resting on its link does).
 * - Only what this person's menu holds (`menu` is the server-filtered menu the sidebar draws).
 * - Once per person and workspace per page load: the shell's layout refreshing does not start it again.
 */
let warmedFor: string | null = null;

export function WarmApp({ menu, scope }: { menu: MenuSection[]; scope: string }) {
  const router = useRouter();
  // Read when the warm-up starts; a refreshed layout's new menu object does not restart it.
  const menuRef = useRef(menu);
  useEffect(() => { menuRef.current = menu; }, [menu]);

  useEffect(() => {
    if (warmedFor === scope) return;
    if (isSlowConnection((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection)) return;
    warmedFor = scope;
    let cancelled = false;

    const run = async () => {
      await pause(WARM_START_MS);
      const { frames, data } = warmPlan(buildSidebarTree(menuRef.current), window.location.pathname);
      for (const href of frames) {
        if (!(await ready(() => cancelled))) return;
        router.prefetch(href);
        await pause(WARM_FRAME_GAP_MS);
      }
      for (const href of data) {
        // Loaded ahead a moment ago by the page that links to it (warm-page.tsx): not again.
        if (recentlyWarmed(href)) continue;
        if (!(await ready(() => cancelled))) return;
        markWarmed(href);
        const reads = ROUTE_RESOURCES[href];
        if (reads) {
          prefetchRoute(href);
          // Wait for this page's reads before the next page's: never two pages' data at once.
          await Promise.allSettled(reads.map((read) => peek(read.key, read.persist)?.pending ?? Promise.resolve()));
        } else {
          router.prefetch(href, FULL);
        }
        await pause(WARM_DATA_GAP_MS);
      }
    };
    void run();
    return () => {
      cancelled = true;
      // Unmounted before it finished (React's dev double mount, signing out): the next mount may start again.
      warmedFor = null;
    };
  }, [scope, router]);

  return null;
}

/** A full prefetch: the page with its data (Next's `PrefetchKind.FULL`, which `<Link prefetch>` uses). */
const FULL = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The browser's next idle moment (a timer where `requestIdleCallback` is missing). */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 4_000 });
    else setTimeout(resolve, 200);
  });
}

/** Until the tab is visible again. */
function visible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });
}

/**
 * The tab is visible, the page on screen is not loading its own links ahead (warm-page.tsx goes first) and the browser
 * is idle; false when the warm-up was stopped meanwhile.
 */
async function ready(cancelled: () => boolean): Promise<boolean> {
  if (cancelled()) return false;
  await visible();
  await pageWarmIdle();
  await idle();
  return !cancelled() && !document.hidden;
}
