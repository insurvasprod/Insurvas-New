"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pruneSelection, selectionCoverage, toggleAllSelected, toggleSelected } from "@/lib/views/tableViews";

/**
 * Bulk selection for a list (2026-10-09): a hook that holds which rows are ticked, checkbox cells
 * for the header and the rows, and the bar that appears above the table once something is ticked.
 *
 * Bulk actions are what a page passes in. Export (a CSV of the selected rows, built in the browser)
 * is the universal one; a bulk write only ever goes through an endpoint that already takes several
 * ids, behind a confirmation — never a single-record endpoint looped over the selection.
 */

export type RowSelection = {
  /** Selected ids that are still in the list. */
  selected: ReadonlySet<string>;
  /** The same, in the list's order. */
  ids: string[];
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Ticks every one of `ids` (default: every visible row), or unticks them when all already are. */
  toggleAll: (ids?: readonly string[]) => void;
  clear: () => void;
  /** For a header checkbox: none, some (indeterminate) or all of `ids` (default: every visible row). */
  coverage: (ids?: readonly string[]) => "none" | "some" | "all";
};

/**
 * `visibleIds` is every row the list currently holds (across pages when it pages on the client).
 * An id that leaves it — filtered out, deleted, moved away on a refresh — is dropped from the
 * selection, so a bulk action never reaches a row the person can no longer see.
 */
export function useRowSelection(visibleIds: readonly string[]): RowSelection {
  const [stored, setStored] = useState<ReadonlySet<string>>(() => new Set());
  // Keyed by content, so a list rebuilt on every render does not re-run anything.
  const visibleKey = visibleIds.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content (visibleKey), not identity
  const visible = useMemo(() => [...visibleIds], [visibleKey]);
  const selected = useMemo(() => pruneSelection(stored, visible), [stored, visible]);
  // Commit the pruning, so an id that left does not come back ticked if the row reappears.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (selected !== stored) setStored(selected); }, [selected, stored]);

  const ids = useMemo(() => visible.filter((id) => selected.has(id)), [visible, selected]);
  const toggle = useCallback((id: string) => setStored((current) => toggleSelected(pruneSelection(current, visible), id)), [visible]);
  const toggleAll = useCallback((subset?: readonly string[]) => setStored((current) => toggleAllSelected(pruneSelection(current, visible), subset ?? visible)), [visible]);
  const clear = useCallback(() => setStored(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const coverage = useCallback((subset?: readonly string[]) => selectionCoverage(selected, subset ?? visible), [selected, visible]);
  return { selected, ids, count: ids.length, isSelected, toggle, toggleAll, clear, coverage };
}

const checkboxClass = "size-4 cursor-pointer accent-[var(--primary)] align-middle";

/** The header cell's checkbox: ticks every row in `ids` (the page on screen, usually); indeterminate when some are. */
export function SelectAllCheckbox({ selection, ids, label = "Select every row on this page", className }: {
  selection: RowSelection;
  ids?: readonly string[];
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const coverage = selection.coverage(ids);
  useEffect(() => { if (ref.current) ref.current.indeterminate = coverage === "some"; }, [coverage]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={coverage === "all"}
      disabled={ids ? ids.length === 0 : false}
      onChange={() => selection.toggleAll(ids)}
      onClick={(event) => event.stopPropagation()}
      className={cn(checkboxClass, className)}
    />
  );
}

/** A row's checkbox. `label` names the row: "Select Maria Lopez". Clicks do not reach the row's own handler. */
export function RowCheckbox({ selection, id, label, className }: { selection: RowSelection; id: string; label: string; className?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={selection.isSelected(id)}
      onChange={() => selection.toggle(id)}
      onClick={(event) => event.stopPropagation()}
      className={cn(checkboxClass, className)}
    />
  );
}

/**
 * Shown only while something is selected: "N selected", the page's actions, "Clear selection".
 * Sits directly above the table (inside the TableCard), so the actions are next to the rows they act on.
 */
export function BulkBar({ count, noun, actions, onClear, className }: {
  count: number;
  /** Singular and plural, e.g. ["lead", "leads"]. Without it the bar reads "3 selected". */
  noun?: readonly [string, string];
  /** Buttons at the default (36px) size. */
  actions?: ReactNode;
  onClear: () => void;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <div role="region" aria-label="Bulk actions" className={cn("flex min-h-[3.25rem] flex-wrap items-center gap-2 border-b border-border bg-[var(--primary-soft)] px-4 py-2", className)}>
      <span className="text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
        {count.toLocaleString()} {noun ? (count === 1 ? noun[0] : noun[1]) + " " : ""}selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions}
        <Button type="button" variant="outline" onClick={onClear}>
          <X aria-hidden="true" />
          Clear selection
        </Button>
      </div>
    </div>
  );
}
