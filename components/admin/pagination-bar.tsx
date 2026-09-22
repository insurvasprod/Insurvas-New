"use client";

// Matches the Insurvas CRM's Pagination component (components/ui/Pagination.tsx): a summary +
// Previous/Next pair, deliberately no numbered page pills.
export function PaginationBar({
  page,
  totalItems,
  itemsPerPage,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  itemsPerPage: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const end = Math.min(safePage * itemsPerPage, totalItems);
  const prevDisabled = safePage <= 1;
  const nextDisabled = safePage >= totalPages;

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3 sm:flex-row">
      <span className="text-sm text-muted-foreground">
        Showing {start}-{end} of {totalItems} {itemLabel}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={prevDisabled}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold tracking-[-0.01em] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={nextDisabled}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold tracking-[-0.01em] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
