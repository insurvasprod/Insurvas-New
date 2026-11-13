"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ROUTE_RESOURCES, prefetchRoute } from "@/lib/client/route-resources";
import { peek } from "@/lib/client/resource-cache";
import { isSlowConnection } from "@/lib/client/warm-plan";
import { WARM_PAGE_GAP_MS, WARM_PAGE_MAX, WARM_PAGE_RESCANS, WARM_PAGE_RESCAN_MS, WARM_PAGE_START_MS, warmPagePlan, type WarmCandidate, type WarmRegion } from "@/lib/client/warm-page-plan";
import { beginPageWarm, endPageWarm, isCurrentPageWarm, markWarmed, recentlyWarmed } from "@/lib/client/warm-queue";

/**
 * Loads ahead what the page on screen links to (owner 2026-11-12: open the page at once, then "on the back" load every
 * tab, sub-page and button on it, so the next click is already here). Mounted once per shell; runs after every
 * navigation:
 *
 * - Waits for the page's own entrance and reads (WARM_PAGE_START_MS), a visible tab and an idle browser.
 * - Reads the links in the page (not the menu or the top bar), in the order lib/client/warm-page-plan.ts sets: tabs,
 *   the step rail, the title line's buttons, then the page's other button-links — never a table's rows.
 * - Loads them one at a time, with a gap: a page that reads in the browser warms its reads (prefetchRoute), a page
 *   drawn on the server is fetched whole (a full prefetch). A "New…" or "Invite…" link loads its panel.
 * - Goes before the app's own warm-up (warm-app.tsx waits on it), stops when the page changes, skips what was loaded
 *   in the last 30 s, and never runs on data saver or 2G.
 */
export function WarmPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";

  useEffect(() => {
    if (isSlowConnection((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection)) return;
    const id = beginPageWarm();
    const live = () => isCurrentPageWarm(id);

    const run = async () => {
      await pause(WARM_PAGE_START_MS);
      if (!(await ready(live))) return;
      const here = `${window.location.pathname}${window.location.search}`;
      // The page's later sections stream in after it opens, with their own links: look again a few times.
      const done = new Set<string>();
      for (let look = 0; look <= WARM_PAGE_RESCANS && done.size < WARM_PAGE_MAX; look += 1) {
        if (look > 0) await pause(WARM_PAGE_RESCAN_MS);
        if (!(await ready(live))) return;
        const plan = warmPagePlan(candidates(), here, window.location.origin).filter((href) => !done.has(href)).slice(0, WARM_PAGE_MAX - done.size);
        for (const href of plan) {
          done.add(href);
          if (recentlyWarmed(href)) continue;
          if (!(await ready(live))) return;
          await warmOne(href);
        }
      }
    };
    const warmOne = async (href: string) => {
      markWarmed(href);
      const reads = ROUTE_RESOURCES[href.split(/[?#]/)[0]];
      if (reads) {
        // The page's code and frame, and its reads into the client cache; wait for those before the next link.
        router.prefetch(href);
        prefetchRoute(href);
        await Promise.allSettled(reads.map((read) => peek(read.key, read.persist)?.pending ?? Promise.resolve()));
      } else {
        router.prefetch(href, FULL);
      }
      await pause(WARM_PAGE_GAP_MS);
    };
    void run().finally(() => endPageWarm(id));
    return () => endPageWarm(id);
  }, [pathname, search, router]);

  return null;
}

/** A full prefetch: the page with its data (Next's `PrefetchKind.FULL`, which `<Link prefetch>` uses). */
const FULL = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

/** The page's links, each with where it sits. The page area only: the shell's menu and top bar are warm-app's. */
function candidates(): WarmCandidate[] {
  const page = document.querySelector<HTMLElement>(".portal-page-transition") ?? document.querySelector<HTMLElement>("[data-page-root]") ?? document.querySelector<HTMLElement>("main");
  if (!page) return [];
  const regionOf = (link: HTMLAnchorElement): WarmRegion => {
    if (link.closest("[role=tablist]")) return "tabs";
    if (link.closest("[data-step-frame] nav.m-glass")) return "rail";
    if (link.closest("header[data-page-header]")) return "header";
    return "body";
  };
  return [...page.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .filter((link) => !link.hasAttribute("download") && link.target !== "_blank" && !link.closest("[aria-hidden=true], [hidden]"))
    .map((link) => ({
      href: link.getAttribute("href") ?? "",
      region: regionOf(link),
      inRow: Boolean(link.closest("tbody, [role=row], [role=rowgroup]")),
      optOut: Boolean(link.closest("[data-no-warm]")),
    }));
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The tab is visible and the browser idle; false once another page has replaced this one. */
async function ready(live: () => boolean): Promise<boolean> {
  if (!live()) return false;
  if (document.hidden) {
    await new Promise<void>((resolve) => {
      const on = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", on); resolve(); } };
      document.addEventListener("visibilitychange", on);
    });
  }
  await new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 2_000 });
    else setTimeout(resolve, 150);
  });
  return live() && !document.hidden;
}
