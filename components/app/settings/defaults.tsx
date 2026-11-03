"use client";

/**
 * Insurvas defaults, said the same way on every Settings page (docs/settings/DEFAULTS.md, owner pick
 * 2026-11-03). Every area reads the agency's own value when it has one and the Insurvas default when
 * it does not, so a new agency can work with nothing set up.
 *
 *   <DefaultChip />      beside a value, row or template that is the Insurvas default.
 *   <ReviewChip />       beside a default whose wording or hours are compliance-sensitive (disclosures,
 *                        calling windows, scripts). Never presented as final.
 *   <ResetToDefault />   the one way back: confirms, then the page's own `onReset` retires or removes
 *                        the agency's value so the default applies again. Shown only when something
 *                        was changed.
 *
 * No notice cards (owner rule 2026-11-02): the chip is the whole marking.
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusChip } from "@/components/ui/status-chip";

export const DEFAULT_LABEL = "Insurvas default";
export const REVIEW_LABEL = "Needs legal review";
const REVIEW_TITLE = "Insurvas wording, not legal advice. Have your compliance lead or counsel approve it before you rely on it.";

export function DefaultChip({ label = DEFAULT_LABEL, className }: { label?: string; className?: string }) {
  return <StatusChip tone="info" dot={false} className={className}>{label}</StatusChip>;
}

export function ReviewChip({ className }: { className?: string }) {
  return <StatusChip tone="warning" title={REVIEW_TITLE} className={className}>{REVIEW_LABEL}</StatusChip>;
}

export function ResetToDefault({
  what,
  kept = "Your earlier versions are kept in the history.",
  onReset,
  disabled,
  label = "Reset to default",
  variant = "ghost",
}: {
  /** What goes back, as a noun phrase: "the Term Life health questions". */
  what: string;
  /** What is not lost, one short sentence. */
  kept?: string;
  /** Retire or remove the agency's own value. Resolves true when it worked (the page reports errors). */
  onReset: () => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
  label?: string;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} disabled={disabled || busy} onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden="true" />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        title="Reset to the Insurvas default?"
        description={`Your changes to ${what} stop applying and the Insurvas default is used again. ${kept}`}
        confirmLabel="Reset to default"
        cancelLabel="Keep mine"
        onConfirm={async () => {
          setBusy(true);
          try {
            const ok = await onReset();
            if (ok !== false) setOpen(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** For a ⋯ menu item: the same question as a promise, through the one ConfirmHost. */
export function resetConfirmOptions(what: string, kept = "Your earlier versions are kept in the history.") {
  return {
    title: "Reset to the Insurvas default?",
    description: `Your changes to ${what} stop applying and the Insurvas default is used again. ${kept}`,
    confirmLabel: "Reset to default",
    cancelLabel: "Keep mine",
  };
}
