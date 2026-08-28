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
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-[var(--color-row-bg)] px-5 py-3 sm:flex-row">
      <span className="text-xs font-semibold text-[var(--brand-700)]">
        Showing {start}-{end} of {totalItems} {itemLabel}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-[var(--brand-700)]">
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={prevDisabled}
            className="rounded-md border border-border px-3.5 py-1.5 text-xs font-bold text-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={nextDisabled}
            className="rounded-md border border-border px-3.5 py-1.5 text-xs font-bold text-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
