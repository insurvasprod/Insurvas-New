import { LoadingRows } from "./page-states";

/**
 * What a page shows between a click and its data: the one loading look for every page (2026-09-28).
 *
 * Rendered by each shell's `loading.tsx` on navigation, and by a workspace while its first read is
 * in flight. Shaped like the page that is coming — the header's actions, the stat strip, then the
 * table card with its toolbar — at the page's full width, so nothing jumps when the data arrives.
 * Inside an already-drawn page use `SectionLoading` (components/ui/page-states.tsx) instead.
 */
export function PageLoading({ strip = true, rows = 8 }: { strip?: boolean; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading</span>
      {/* The header's shape (owner 2026-10-30): the trail, then the title with the actions on its line. */}
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <div className="flex min-h-6 items-center"><div className="h-3 w-32 m-skel rounded-full" /></div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="h-7 w-48 max-w-[60%] m-skel rounded-md" />
          <div className="hidden gap-2 sm:flex">
            <div className="h-9 w-24 m-skel rounded-md" />
            <div className="h-9 w-28 m-skel rounded-md" />
          </div>
        </div>
      </div>
      {strip && (
        <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2.5 bg-card px-4 py-3.5">
                <div className="h-3 w-20 m-skel rounded-full" />
                <div className="h-6 w-14 m-skel rounded-md" />
                <div className="h-3 w-32 max-w-full m-skel rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}
      <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <div className="h-9 w-64 max-w-[45%] m-skel rounded-md" />
          <div className="h-9 w-28 m-skel rounded-md" />
          <div className="ml-auto h-9 w-24 m-skel rounded-md" />
        </div>
        <LoadingRows rows={rows} columns={5} />
      </div>
    </div>
  );
}
