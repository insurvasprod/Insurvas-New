"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";
import { pruneSelection, selectionCoverage, toggleAllSelected, toggleSelected } from "@/lib/views/tableViews";

/**
 * Bulk selection for a list (2026-10-09): a hook that holds which rows are ticked, checkbox cells
 * for the header and the rows (the kit's CheckBox), and the bar that slides over the table's top once something is ticked.
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

/** The header cell's checkbox: ticks every row in `ids` (the page on screen, usually); a dash (mixed) when some are. */
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
    <CheckBox
      ref={ref}
      aria-label={label}
      checked={coverage === "all"}
      mixed={coverage === "some"}
      disabled={ids ? ids.length === 0 : false}
      onChange={() => selection.toggleAll(ids)}
      onClick={(event) => event.stopPropagation()}
      className={className}
    />
  );
}

/** A row's checkbox. `label` names the row: "Select Maria Lopez". Clicks do not reach the row's own handler. */
export function RowCheckbox({ selection, id, label, className }: { selection: RowSelection; id: string; label: string; className?: string }) {
  return (
    <CheckBox
      aria-label={label}
      checked={selection.isSelected(id)}
      onChange={() => selection.toggle(id)}
      onClick={(event) => event.stopPropagation()}
      className={className}
    />
  );
}

/**
 * "N selected", the page's actions, "Clear selection" (Tier 2 motion, owner sign-off 2026-11-18). Always in the page:
 * it lies over the table's top edge, slides down when rows are ticked and back up when they are not, and its count
 * rolls, so the table under it never jumps. Place it directly above the table (inside the TableCard), so the
 * actions are next to the rows they act on.
 *
 * While open it covers the header row, and with it the select-all box: pass that box as `selectAll` and the bar
 * carries it at its left, so "take the whole page" stays one click away.
 */
type BulkBarProps = {
  count: number;
  /** Singular and plural, e.g. ["lead", "leads"]. Without it the bar reads "3 selected". */
  noun?: readonly [string, string];
  /** Buttons at the default (36px) size. */
  actions?: ReactNode;
  onClear: () => void;
  /** The header's `<SelectAllCheckbox>` again, shown in the bar since the bar covers the header. */
  selectAll?: ReactNode;
  className?: string;
};

const BAR = "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-[var(--primary-soft)] px-4 py-2";

/** Always mounted, open while something is ticked; it keeps the last count as it slides away. */
export function BulkBar({ count, noun, actions, onClear, selectAll, className }: BulkBarProps) {
  const [last, setLast] = useState(count);
  if (count > 0 && count !== last) setLast(count);
  const open = count > 0;
  const shown = open ? count : last;
  return (
    <div className="relative z-10 h-0">
      <div
        role="region"
        aria-label="Bulk actions"
        aria-hidden={open ? undefined : true}
        inert={!open}
        data-bulk-bar=""
        data-state={open ? "open" : "closed"}
        className={cn(BAR, "absolute inset-x-0 top-0", className)}
      >
        {/* Clear is a small icon at the left of the count; the actions are one compact row at the right (owner 2026-11-05). */}
        <span className="flex items-center gap-1.5">
          {selectAll ? <span className="mr-1.5 inline-flex">{selectAll}</span> : null}
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection" title="Clear selection">
            <X aria-hidden="true" />
          </Button>
          <span className="text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
            <CountUp text={shown.toLocaleString()} changesOnly duration={360} /> {noun ? (shown === 1 ? noun[0] : noun[1]) + " " : ""}selected
          </span>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2 [&_[data-slot=button]]:h-8 [&_[data-slot=button]]:px-3 [&_[data-slot=button]]:text-sm">
          {actions}
        </div>
      </div>
    </div>
  );
}
