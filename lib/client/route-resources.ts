import { prefetch } from "./resource-cache";

/**
 * What each page reads from the browser on arrival (speed pass 2026-11-09), so resting on a link to it warms the
 * data as well as the page: by the click the answer is usually here, and the page draws with it at once. Only
 * addresses that the page itself reads with `useResource` belong here — the same key, or the warm-up is wasted.
 * Keep each list to what the page needs first; the rest arrives as it always did.
 */
export const ROUTE_RESOURCES: Record<string, ReadonlyArray<{ key: string; persist?: boolean }>> = {
  "/app/callbacks": [{ key: "/api/app/callbacks", persist: true }],
  "/app/leads": [{ key: "/api/app/leads", persist: true }, { key: "/api/app/leads/pipeline-context", persist: true }],
  "/app/calendar": [{ key: "/api/app/appointments" }, { key: "/api/app/callbacks", persist: true }],
  "/app/appointments": [{ key: "/api/app/appointments" }, { key: "/api/app/callbacks", persist: true }],
  "/app/partner-chat": [{ key: "/api/app/partner-chat", persist: true }],
  "/app/publishers": [{ key: "/api/app/partners", persist: true }],
  "/app/dialer": [{ key: "/api/app/dialer/queue?priority=all", persist: true }],
  "/app/campaigns": [{ key: "/api/app/campaigns", persist: true }, { key: "/api/app/vendors", persist: true }],
  "/app/campaigns/vendors": [{ key: "/api/app/campaigns", persist: true }, { key: "/api/app/vendors", persist: true }],
  "/app/import": [{ key: "/api/app/leads/import", persist: true }],
  "/app/duplicates": [{ key: "/api/app/contacts?q=&page=0&pageSize=10", persist: true }],
  "/app/assignments": [{ key: "/api/app/assignments", persist: true }],
  "/app/lead-routing": [{ key: "/api/app/assignments", persist: true }],
  "/app/nurture": [{ key: "/api/app/nurture", persist: true }],
  "/app/scoring": [{ key: "/api/app/scoring?period=14d", persist: true }],
  "/app/tcpa": [{ key: "/api/app/suppression?limit=500", persist: true }],
  // Deal flow and Consent read addresses that change by the day or the window's height: no fixed warm-up.
};

/** Warm the reads of the page at `href` (its path, query ignored). */
export function prefetchRoute(href: string) {
  const path = href.split(/[?#]/)[0];
  for (const resource of ROUTE_RESOURCES[path] ?? []) prefetch(resource.key, { persist: resource.persist });
}
