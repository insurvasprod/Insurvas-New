"use client";

import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The pen and the bin at the end of a Campaigns or Compare vendors row (owner 2026-10-29). Icon-only,
 * side by side on one line at the full 36px icon size, each named for screen readers and on hover.
 * The row itself still opens on a click, so both stop the click here. A bin that cannot act is
 * disabled and its title says why (the span carries the title, since a disabled button gets no hover).
 */
export function RowActions({ what, name, onEdit, onDelete, deleteBlocked = null, deleteDisabled = false }: {
  what: "campaign" | "vendor";
  name: string;
  onEdit: () => void;
  onDelete: () => void;
  /** Why it cannot be deleted, when the screen already knows. */
  deleteBlocked?: string | null;
  /** Busy: another delete is in flight. */
  deleteDisabled?: boolean;
}) {
  const editLabel = `Edit ${what}`;
  const deleteLabel = `Delete ${what}`;
  return <span className="inline-flex flex-nowrap items-center justify-center gap-0.5" onClick={(event) => event.stopPropagation()}>
    <Button type="button" variant="ghost" size="icon" aria-label={`${editLabel} ${name}`} title={editLabel} onClick={(event) => { event.stopPropagation(); onEdit(); }}>
      <Pencil aria-hidden="true" />
    </Button>
    <span className="inline-flex" title={deleteBlocked ?? deleteLabel}>
      <Button type="button" variant="ghost" size="icon" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" aria-label={deleteBlocked ? `${deleteLabel} ${name} — ${deleteBlocked}` : `${deleteLabel} ${name}`} disabled={deleteBlocked !== null || deleteDisabled} onClick={(event) => { event.stopPropagation(); onDelete(); }}>
        <Trash2 aria-hidden="true" />
      </Button>
    </span>
  </span>;
}
