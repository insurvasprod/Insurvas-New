import { LoadingRows } from "./page-states";

/**
 * What a portal shows between a click and the next page's first byte.
 *
 * Rendered by each shell's `loading.tsx`, so the sidebar stays put and only the content area swaps
 * to this at once — without it the old page sat frozen until the server finished, which read as
 * the click not having registered. Shaped like the page that is coming (a header, then a table
 * card) so nothing jumps when it arrives.
 */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-6xl space-y-6">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-8 w-56 m-skel rounded-md" />
        <div className="h-4 w-80 max-w-full m-skel rounded-full" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <LoadingRows rows={6} columns={4} />
      </div>
    </div>
  );
}
