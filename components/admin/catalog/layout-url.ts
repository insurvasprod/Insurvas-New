/**
 * Patches the page's query in place: no server round trip, no history entry, and `useSearchParams` sees the change.
 *
 * Why not `setParamsInPlace` (components/ui/nav-pending.tsx): it hands `window.history.state` back to
 * `replaceState`, and that state carries Next's own `__NA` marker, which is exactly what Next's patched
 * `replaceState` skips (node_modules/next/dist/client/components/app-router.js) — so the address changes but
 * `useSearchParams` never hears of it. Passing no state lets Next copy its own state over and sync the hooks.
 * Used by the Catalog's Layout maps, Status maps and Field maps lists.
 */
export function patchQuery(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
