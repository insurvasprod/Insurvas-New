"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, textareaControl } from "@/components/ui/field";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { dollars } from "@/lib/agency/constants";
import { notify } from "@/lib/notify";
import { sendJson } from "@/components/app/agency/use-agency-data";

export type ReviewItem = { id: string; producerUserId: string; kind: "expected_reported" | "reported_received"; varianceCents: number; status: "open" | "reviewed"; note: string | null; periodStart: string; periodEnd: string };

export const REVIEW_KIND: Record<ReviewItem["kind"], string> = { expected_reported: "Expected vs reported", reported_received: "Reported vs received" };
export const READ_ONLY_REASON = "Paused while the account is read-only.";

/**
 * Producer pay's review (mockups-r7/commissions.html 4·2): the difference, what the producer's figures were, what
 * you found, Mark reviewed. Marking it changes no number. A reviewed item opens with its note as text.
 */
export function ReviewDialog({ review, name, facts, readOnly, onClose }: {
  review: ReviewItem | null;
  name: string;
  /** Expected · Reported · Received for the month, label and value. */
  facts?: Array<[string, ReactNode]>;
  readOnly: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reviewed = review?.status === "reviewed";

  async function markReviewed() {
    if (!review) return;
    if (!note.trim()) { setError("Write what you found."); return; }
    setSaving(true);
    const { error: message } = await sendJson("/api/app/agency/reconciliation", "POST", { itemId: review.id, note: note.trim() });
    setSaving(false);
    if (message) { notify.fail("That didn't save. Try again; nothing was changed."); return; }
    notify.done("Marked reviewed. The numbers are unchanged; a correction is an adjustment on the ledger.");
    setNote("");
    onClose();
    refreshStepCounts();
    router.refresh();
  }

  return (
    <Dialog open={Boolean(review)} onOpenChange={(open) => { if (!open) { setError(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {name}</DialogTitle>
          <DialogDescription>
            {review && <>{REVIEW_KIND[review.kind]}: {dollars(review.varianceCents)}. {reviewed ? "Reviewed; it changed no number." : "Marking it reviewed changes no number."}</>}
          </DialogDescription>
        </DialogHeader>
        {facts && facts.length > 0 && (
          <dl className="m-0 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {facts.map(([label, value]) => <div key={label} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 text-foreground">{value}</dd></div>)}
          </dl>
        )}
        {reviewed || readOnly ? (
          <Field label="What you found" htmlFor="review-note-text">
            <p id="review-note-text" className="m-0 text-sm text-foreground">{review?.note || (readOnly && !reviewed ? READ_ONLY_REASON : "No note.")}</p>
          </Field>
        ) : (
          <Field label="What you found" htmlFor="review-note" hint="For example: the carrier pays this level next cycle." error={error ?? undefined}>
            <textarea id="review-note" className={textareaControl} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{reviewed || readOnly ? "Close" : "Cancel"}</Button>
          {!reviewed && !readOnly && <Button onClick={markReviewed} disabled={saving}>{saving ? "Saving" : "Mark reviewed"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The producer page's title-line primary: "Review $212.40", opening the same dialog. */
export function ReviewButton({ review, name, readOnly }: { review: ReviewItem; name: string; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>Review {dollars(review.varianceCents)}</Button>
      <ReviewDialog review={open ? review : null} name={name} readOnly={readOnly} facts={[["Difference", REVIEW_KIND[review.kind]], ["Month", new Date(`${review.periodStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })]]} onClose={() => setOpen(false)} />
    </>
  );
}
