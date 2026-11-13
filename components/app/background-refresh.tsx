"use client";

import { startTransition, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { lastNavAskedAt } from "@/components/ui/nav-pending";

/**
 * Show then refresh, for server-rendered pages (speed pass 2026-11-09). The router keeps a page it drew for 30s
 * (`experimental.staleTimes` in next.config.ts), so going back to it — a tab, a step, the browser's back — is
 * instant. That copy may be a little old, so when a page lands that quickly (it was served from the cache, not the
 * server) it is asked for again behind what is shown; the fresh answer replaces it in place, with no skeleton and
 * no second entrance. A page that came from the server is already fresh and is left alone.
 */
const FROM_CACHE_MS = 150;

export function BackgroundRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // a hard load is fresh
    if (performance.now() - lastNavAskedAt() > FROM_CACHE_MS) return;
    const timer = window.setTimeout(() => startTransition(() => router.refresh()), 60);
    return () => window.clearTimeout(timer);
  }, [pathname, router]);
  return null;
}
