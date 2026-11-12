"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { notify } from "@/lib/notify";

import { READ_ONLY_HINT, postPayIssue } from "./check-now";

const VIA = [
  { value: "email", label: "Email", word: "email" },
  { value: "portal", label: "The carrier's portal", word: "the carrier's portal" },
  { value: "post", label: "Post", word: "post" },
] as const;
const OUTCOMES = [
  { value: "accepted", label: "Accepted in full" },
  { value: "partial", label: "Partly credited" },
  { value: "rejected", label: "Rejected" },
] as const;

const toCents = (text: string): number | null => {
  const m = /^\s*\$?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(text);
  return m ? Number(m[1].replaceAll(",", "")) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
};

/**
 * A letter's title line (round 7, 2·4–2·5): the primary follows the state — a saved letter shows "Mark sent" (how it
 * went), a sent or acknowledged one "Record the outcome", a settled one none. Download PDF stays; ⋯ holds Mark
 * acknowledged (sent letters) and the carrier's statements. Insurvas never sends a letter: these record what you did.
 */
export function LetterActions({ letter, readOnly, statementsHref }: {
  letter: { id: string; status: string; carrierName: string; dateWords: string; claimedWords: string };
  readOnly: boolean;
  statementsHref: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"sent" | "outcome" | null>(null);
  const [via, setVia] = useState<(typeof VIA)[number]["value"]>("email");
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"]>("accepted");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const pdf = `/api/app/commission-discrepancies/disputes/${letter.id}/pdf`;

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await postPayIssue(body);
      setDialog(null);
      refreshStepCounts();
      notify.done(done);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const cents = outcome === "rejected" || !amount.trim() ? null : toCents(amount);
  const amountError = outcome !== "rejected" && ((amount.trim() && cents === null) || (outcome === "partial" && !amount.trim())) ? "Enter the amount, like 412.50." : null;
  const primary = letter.status === "draft" ? "sent" : letter.status === "sent" || letter.status === "acknowledged" ? "outcome" : null;

  return (
    <>
      <Button asChild type="button" variant="outline"><a href={pdf} download><Download aria-hidden="true" />Download PDF</a></Button>
      {primary && (
        <span title={readOnly ? READ_ONLY_HINT : undefined}>
          <Button type="button" disabled={readOnly || busy} onClick={() => { setTried(false); setAmount(""); setNotes(""); setDialog(primary); }}>{primary === "sent" ? "Mark sent" : "Record the outcome"}</Button>
        </span>
      )}
      <MoreMenu label="More" items={[
        !readOnly && letter.status === "sent" && { label: "Mark acknowledged", onSelect: () => void run({ action: "mark_acknowledged", dispute_id: letter.id }, "Marked acknowledged.") },
        { label: "Open the carrier's statements", href: statementsHref },
      ]} />

      <Dialog open={dialog === "sent"} onOpenChange={(next) => { if (!busy && !next) setDialog(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="text-base">How did you send it?</DialogTitle>
            <DialogDescription>Letter to {letter.carrierName} · {letter.dateWords} · {letter.claimedWords} claimed. It is marked sent today.</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="How it was sent" className="flex flex-wrap gap-2">
            {VIA.map((v) => <ToggleChip key={v.value} role="radio" selected={via === v.value} disabled={busy} onClick={() => setVia(v.value)}>{v.label}</ToggleChip>)}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void run({ action: "mark_sent", dispute_id: letter.id, via }, `Marked sent by ${VIA.find((v) => v.value === via)!.word}.`)}>Mark sent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "outcome"} onOpenChange={(next) => { if (!busy && !next) setDialog(null); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="text-base">How did it end?</DialogTitle>
            <DialogDescription>Recorded for {letter.carrierName}&apos;s dispute record.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div role="radiogroup" aria-label="Outcome" className="flex flex-wrap gap-2">
              {OUTCOMES.map((o) => <ToggleChip key={o.value} role="radio" selected={outcome === o.value} disabled={busy} onClick={() => setOutcome(o.value)}>{o.label}</ToggleChip>)}
            </div>
            {outcome !== "rejected" && (
              <Field label={outcome === "partial" ? "Amount credited ($)" : "Amount credited ($, blank: the full claim)"} htmlFor="letter-amount" error={tried ? amountError : undefined}>
                <input id="letter-amount" className={control} inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            <Field label="Notes (optional)" htmlFor="letter-notes">
              <input id="letter-notes" className={control} maxLength={4000} placeholder="What the carrier said" value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => {
              if (amountError) { setTried(true); return; }
              void run({ action: "record_outcome", dispute_id: letter.id, outcome, amount_cents: cents, notes: notes.trim() || null }, "Outcome recorded. The letter moved to Settled.");
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
