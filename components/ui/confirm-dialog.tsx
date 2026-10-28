"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The alert dialog (UI-CONSISTENCY §11, foundation v3): a step that loses something. 400px, a red
 * mark when it is destructive, what is lost said plainly, and buttons named by their action
 * ("Keep policy" / "Cancel policy"), never OK / Cancel. It replaces `window.confirm`, which drew the
 * browser's own grey box in the middle of the product.
 *
 * Two ways to use it:
 *   <ConfirmDialog open … onConfirm={…} />   when the page already holds the state.
 *   `if (!(await confirmAction({ … }))) return;`   in place of `if (!window.confirm(…)) return;`.
 *      The one <ConfirmHost /> in app/layout.tsx draws it, so any handler can ask.
 */
export type ConfirmOptions = {
  title: string;
  /** What happens, and what is lost. One or two short sentences. */
  description?: ReactNode;
  /** The action, as a verb: "Delete key", "Cancel policy". */
  confirmLabel: string;
  /** The way back: "Keep key". Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red mark and a red button. Default true: most confirmations are a loss. */
  destructive?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  busy = false,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  children,
}: ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
  /** A summary of what is affected, drawn in a bordered box under the description. */
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent size="sm" role="alertdialog" showCloseButton={false}>
        <DialogHeader className="gap-3">
          {destructive && (
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--error-surface)] text-[var(--error-ink)]" aria-hidden="true">
              <TriangleAlert className="size-5" />
            </span>
          )}
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription className="text-[var(--body)]">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children && <div className="rounded-md border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--body)]">{children}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── confirmAction(): the promise form, drawn by one host ───────────────── */

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Ask, and wait for the answer: true when the person chose the action. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

function settle(ok: boolean) {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(ok);
}

/** Mounted once, in app/layout.tsx. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => pending,
    () => null,
  );
  const [last, setLast] = useState<Pending | null>(null);
  // Keep the content while the dialog animates out.
  if (current && current !== last) setLast(current);
  const shown = current ?? last;
  if (!shown) return null;
  return (
    <ConfirmDialog
      {...shown}
      open={current !== null}
      onOpenChange={(open) => { if (!open) settle(false); }}
      onConfirm={() => settle(true)}
    />
  );
}
