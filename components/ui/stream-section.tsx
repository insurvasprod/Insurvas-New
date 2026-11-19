import { Suspense, type ReactNode } from "react";

import { PageLoading, StripLoading } from "./page-loading";
import { LoadingRows, SectionLoading } from "./page-states";

/**
 * Frame first, data after (UI-CONSISTENCY §7, owner 2026-11-12). One block of a page that waits on its own read, under
 * a frame that has already drawn: a `<Suspense>` whose fallback has the shape and height of what replaces it, so
 * nothing moves when the data lands. The skeleton bars wait 180ms (.m-skel), so a block whose read is quick draws as
 * if it came with the frame; one that takes longer settles in place (the cascade's [data-settle], never a second slide).
 *
 * A server page does its gate checks, starts every read as a promise (so the top block is never queued behind a list),
 * returns its frame at once, and puts each block in one of these, top to bottom:
 *
 *   const strip = loadTotals(tenantId);           // started, not awaited
 *   const rows = loadRows(tenantId);
 *   return (
 *     <DataInPage step="…" tabs={…} actions={…}>
 *       <StreamSection shape="strip"><Totals read={strip} /></StreamSection>
 *       <StreamSection shape="table"><Rows read={rows} /></StreamSection>
 *     </DataInPage>
 *   );
 *
 * Shapes:
 *   table        a table card: toolbar and rows (the usual list page)
 *   strip+table  the stat strip, then the table card (a list page with its totals, as one block)
 *   strip        the stat strip alone (figures that belong together: one block, never one tile at a time)
 *   cards        a grid of `cards` small cards
 *   form         an editor's fields: a form fills in as a whole, never field by field
 *   rows         rows only, for a block inside a card the page already drew
 *
 * `rows` sets how many rows the table, cards or form draw; `columns` the table's or rows' columns.
 */
export type StreamShape = "table" | "strip+table" | "strip" | "cards" | "form" | "rows";

export function StreamSection({ shape = "table", rows, columns, cards = 2, label, children }: {
  shape?: StreamShape;
  rows?: number;
  columns?: number;
  cards?: number;
  /** What a screen reader hears while it loads ("Loading" by default). */
  label?: string;
  children: ReactNode;
}) {
  return <Suspense fallback={<StreamFallback shape={shape} rows={rows} columns={columns} cards={cards} label={label} />}>{children}</Suspense>;
}

/** The fallback alone, for a client block that waits on its own read (render it while `loading`). */
export function StreamFallback({ shape = "table", rows, columns, cards = 2, label = "Loading" }: { shape?: StreamShape; rows?: number; columns?: number; cards?: number; label?: string }) {
  if (shape === "table") return <PageLoading header={false} strip={false} rows={rows ?? 8} />;
  if (shape === "strip+table") return <PageLoading header={false} rows={rows ?? 8} />;
  if (shape === "strip") return <StripLoading />;
  if (shape === "rows") return <SectionLoading rows={rows ?? 5} columns={columns ?? 4} label={label} />;
  if (shape === "cards") {
    return (
      <div role="status" aria-live="polite" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <span className="sr-only">{label}</span>
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} aria-hidden="true" className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3"><div className="h-3 w-28 m-skel rounded-full" /></div>
            <LoadingRows rows={rows ?? 3} columns={columns ?? 3} />
          </div>
        ))}
      </div>
    );
  }
  // form: label and field pairs in one card, as an editor draws them.
  return (
    <div role="status" aria-live="polite" className="overflow-hidden rounded-lg border border-border bg-card p-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        {Array.from({ length: rows ?? 5 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="h-3 w-28 m-skel rounded-full" />
            <div className="h-9 w-full max-w-md m-skel rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A page name not known yet (a record's, read from its data): its shape on the title's line, as PageLoading draws it.
 * Pass it as the Suspense fallback of `PageHeader`'s `title` (page-header.tsx) (UI-CONSISTENCY §7, frame first). The bar waits 180ms like
 * every skeleton (.m-skel), so a name that lands sooner never flashes one.
 */
export function TitleShape() {
  return (
    <span className="inline-flex min-h-9 items-center align-middle">
      <span className="sr-only">Loading</span>
      <span aria-hidden="true" className="inline-block h-7 w-48 max-w-[60vw] m-skel rounded-md" />
    </span>
  );
}
