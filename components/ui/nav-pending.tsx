"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * Moving between views without reloading the page (2026-11-08, "feel instant"). Three kinds of switch, one rule each:
 *
 * 1. **A pure view toggle** (a chart's figure, a table's columns): client state, and the address follows with
 *    `setParamsInPlace` — `history.replaceState`, which Next's router syncs into `useSearchParams` without asking the
 *    server for anything.
 * 2. **A tab or step that needs the server**: an `IntentLink` (or `useNavTransition` for a control). The navigation
 *    runs in a transition, so the title, the tabs and the rail stay on screen; only the content (`data-page-content`)
 *    dims after 120ms while it waits (globals.css), then swaps in with the one 150ms `m-content-in`.
 * 3. **A step on a merged page**: the shell's loading state draws the same frame (ShellLoading), so only the step's
 *    column shows a skeleton.
 *
 * The dimming is CSS only: anything pending puts a hidden `[data-nav-pending]` marker in the page, and
 * `main:has([data-nav-pending]) [data-page-content]` does the rest, so a server-rendered region needs no wiring.
 */

/** A hidden marker while `pending`: the content under the same `<main>` dims (globals.css). */
export function NavPending({ pending }: { pending: boolean }) {
  return pending ? <span data-nav-pending="" hidden /> : null;
}

/** Inside a `<Link>`: marks it, and dims the content, while its navigation waits on the server. */
function LinkPending() {
  const { pending } = useLinkStatus();
  return <NavPending pending={pending} />;
}

/**
 * `router.push` in a transition, for a control that is not a link (a select, a chip, a row): the page stays as it is
 * until the new one is ready, and `pending` is true meanwhile. Render `<NavPending pending={pending} />` beside it.
 */
export function useNavTransition() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string) => start(() => router.push(href, { scroll: false }));
  return [pending, go] as const;
}

/**
 * A pure view toggle's address: patches the query in place (`history.replaceState`). No server round trip and no
 * history entry; `useSearchParams` sees the change, so a later server navigation carries it along.
 */
export function setParamsInPlace(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** How long a pointer rests on a link before its whole route is fetched: passing over a row of tabs fetches nothing. */
const INTENT_MS = 80;

/**
 * Which way a navigation moves, for the page that arrives (§ Motion, components/portal/portal-page-transition.tsx):
 * `transitionTypes={["nav-forward"]}` → `html[data-nav="forward"]`, `["nav-back"]` → `back`, none → `area`. A
 * navigation that never lands (a slow page abandoned) is cleared after a while so a later page does not replay it.
 */
let navMarkTimer: ReturnType<typeof setTimeout> | undefined;
export function markNavDirection(types?: readonly string[]) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.nav = types?.includes("nav-forward") ? "forward" : types?.includes("nav-back") ? "back" : "area";
  clearTimeout(navMarkTimer);
  navMarkTimer = setTimeout(clearNavDirection, 10_000);
}
export function clearNavDirection() {
  if (typeof document === "undefined") return;
  clearTimeout(navMarkTimer);
  delete document.documentElement.dataset.nav;
}

/**
 * A `<Link>` for a tab or a rail step. Next prefetches a dynamic route only down to the shell's loading state; once
 * the pointer rests on this link (or it takes focus) it prefetches the whole route (`prefetch={true}`, the
 * hover-prefetch pattern in Next's linking guide), so the click usually lands on a page that is already here. It
 * marks itself pending while its navigation waits (`[data-nav-pending]`).
 */
export function IntentLink({ children, onMouseEnter, onMouseLeave, onFocus, onClick, prefetch, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const off = prefetch === false;
  return (
    <Link
      {...props}
      prefetch={intent && !off ? true : prefetch}
      onMouseEnter={(event) => { onMouseEnter?.(event); if (timer.current) clearTimeout(timer.current); if (!off) timer.current = setTimeout(() => setIntent(true), INTENT_MS); }}
      onMouseLeave={(event) => { onMouseLeave?.(event); if (timer.current) clearTimeout(timer.current); }}
      onFocus={(event) => { onFocus?.(event); if (!off) setIntent(true); }}
      onClick={(event) => {
        onClick?.(event);
        // A plain click that navigates here (not a new tab, not a click the caller cancelled) marks its direction.
        if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) markNavDirection(props.transitionTypes);
      }}
    >
      {children}
      <LinkPending />
    </Link>
  );
}
