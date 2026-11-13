"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, textareaControl } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { ChoiceList, type Choice } from "@/components/app/book/needs-you/choice-list";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { chargebackAcceptedNote } from "@/lib/needsYou/kinds";
import { notify } from "@/lib/notify";
import { payIssueLetterHref, payIssueMoney as money, type PayIssue } from "@/lib/commissions/payIssueGroups";

import { READ_ONLY_HINT, patchHandIssue, postPayIssue } from "./check-now";

type DecideKey = "letter" | "rate" | "accept" | "paid" | "write_off" | "dismiss" | "reopen";
const RATE_KINDS = new Set(["missing", "short_paid", "over_paid", "mis_rated"]);

export type DecideIssue = Pick<PayIssue, "id" | "source" | "type" | "carrierId" | "carrierName" | "policyNumber" | "clientName" | "status" | "disputable" | "owedToYouCents" | "owedToCarrierCents" | "disputeId">;

/** The hand-statement letter page (outside the frame, printable) for these findings of one carrier. */
export const handLetterHref = (carrierId: string, ids: string[]) => `/app/discrepancies/letter?${new URLSearchParams({ carrier: carrierId, ids: ids.join(",") })}`;

/**
 * An issue's title line (round 7, 2·2–2·3): "Decide" opens ONE dialog for both sources, worded the same everywhere:
 * put it on a letter, the rate is wrong, it was paid outside the statement, write it off, dismiss (and Open again for
 * a closed one). Save stays here; "Save and open {next}" walks the group. An issue already in a letter shows "Open
 * the letter" instead: its next step is the letter's. ⋯ holds Put it on a letter, Open the policy and Open again.
 */
export function IssueActions({ issue, readOnly, nextHref, nextName, listHref, rateHref, policyHref }: {
  issue: DecideIssue;
  readOnly: boolean;
  nextHref: string | null;
  nextName: string | null;
  listHref: string;
  rateHref: string;
  policyHref: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<DecideKey | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = issue.clientName ?? issue.policyNumber ?? `${issue.carrierName}'s account`;
  const closed = issue.status === "closed";
  const hand = issue.source === "hand";

  const choices: Choice<DecideKey>[] = closed
    ? [{ key: "reopen", label: "Open again", hint: "it goes back on Open, with its figures as the files now show them" }]
    : [
      ...(issue.disputable ? [{ key: "letter" as const, label: `Put it on a letter to ${issue.carrierName}`, hint: hand ? "opens the printable letter; you send it" : "with the figures; you send it" }] : []),
      ...(RATE_KINDS.has(issue.type) ? [{ key: "rate" as const, label: "The rate is wrong", hint: `opens Setup › Rate card at ${issue.carrierName}` }] : []),
      ...(!hand && issue.type === "unexpected_chargeback" ? [{ key: "accept" as const, label: "The client cancelled: the chargeback is right", hint: "closes it as accepted; the chargeback stays in the ledger" }] : []),
      { key: "paid", label: "It was paid outside the statement", hint: "say when and how" },
      { key: "write_off", label: "Write it off", hint: "say why; it stays on record" },
      { key: "dismiss", label: "Dismiss", hint: "stays dismissed even if the files keep showing it" },
    ];
  const needsNote = choice === "paid" || choice === "write_off" || choice === "dismiss";
  const noteLabel = choice === "paid" ? "When and how it was paid" : choice === "write_off" ? "Why it is written off" : choice === "dismiss" ? "Why" : "Anything to add (optional)";
  const withNote = choice === "paid" || choice === "write_off" || choice === "dismiss" || choice === "accept";
  const missingNote = needsNote && !note.trim();

  function start(pick: DecideKey | null) {
    setChoice(pick ?? (closed ? "reopen" : issue.disputable ? "letter" : null));
    setNote("");
    setTried(false);
    setOpen(true);
  }

  async function save(then: "stay" | "next") {
    if (!choice) return;
    if (missingNote) { setTried(true); return; }
    if (choice === "rate") { setOpen(false); router.push(rateHref); return; }
    if (choice === "letter" && hand) {
      if (issue.carrierId) window.open(handLetterHref(issue.carrierId, [issue.id]), "_blank", "noopener");
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const text = note.trim();
      let done = "Saved.";
      let letterId: string | null = null;
      if (choice === "letter") {
        const data = await postPayIssue({ action: "draft_dispute", ids: [issue.id], recipient: null });
        letterId = String(data.id ?? "") || null;
        done = "Letter saved. Download it on Letters out, send it, then mark it sent.";
      } else if (hand) {
        const status = choice === "reopen" ? "open" : choice === "paid" ? "resolved" : "written_off";
        await patchHandIssue(issue.id, status, choice === "dismiss" ? `Dismissed: ${text}` : text || null);
        done = choice === "reopen" ? "Opened again." : choice === "paid" ? "Marked settled." : choice === "dismiss" ? "Dismissed." : "Written off.";
      } else if (choice === "accept") {
        await postPayIssue({ action: "set_status", id: issue.id, status: "accepted", note: chargebackAcceptedNote(text) });
        done = "Chargeback accepted.";
      } else {
        const status = choice === "reopen" ? "open" : choice === "paid" ? "resolved" : "dismissed";
        await postPayIssue({ action: "set_status", id: issue.id, status, note: choice === "reopen" ? null : choice === "write_off" ? `Written off: ${text}` : text });
        done = choice === "reopen" ? "Opened again." : choice === "paid" ? "Marked settled." : choice === "dismiss" ? "Dismissed." : "Written off.";
      }
      setOpen(false);
      refreshStepCounts();
      const nextWords = then === "next" && nextName ? ` ${nextName} is open next.` : "";
      notify.done(`${done}${nextWords}`, letterId ? { action: { label: "Open it", onClick: () => router.push(payIssueLetterHref(letterId!)) } } : undefined);
      if (then === "next") router.push(nextHref ?? listHref);
      else router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const owed = issue.owedToYouCents ? `${money(issue.owedToYouCents)} owed to you` : issue.owedToCarrierCents ? `${money(issue.owedToCarrierCents)} owed to the carrier` : null;
  const inLetter = issue.status === "letter" && issue.disputeId;
  return (
    <>
      <span title={readOnly && !inLetter ? READ_ONLY_HINT : undefined}>
        {inLetter
          ? <Button asChild type="button"><Link href={payIssueLetterHref(issue.disputeId!)}>Open the letter</Link></Button>
          : <Button type="button" disabled={readOnly || (issue.status === "letter" && !hand)} onClick={() => start(null)}>Decide</Button>}
      </span>
      <MoreMenu label="More" items={[
        !readOnly && issue.disputable && { label: "Put it on a letter", onSelect: () => start("letter") },
        policyHref && { label: "Open the policy", href: policyHref },
        !readOnly && (closed || (hand && issue.status === "letter")) && { label: "Open again", onSelect: () => start("reopen") },
      ]} />

      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle className="text-base">What do you want to do?</DialogTitle>
            <DialogDescription>{[who, issue.policyNumber && issue.clientName ? issue.policyNumber : null, owed].filter(Boolean).join(" · ")}</DialogDescription>
          </DialogHeader>
          <ChoiceList
            name="pay-issue-decide"
            label="What do you want to do?"
            value={choice}
            onChange={(key) => { setChoice(key); setTried(false); }}
            disabled={busy}
            choices={choices.map((c) => c.key === choice && withNote ? {
              ...c,
              children: (
                <Field label={noteLabel} htmlFor="decide-note" error={tried && missingNote ? "Say why, for whoever looks next." : undefined}>
                  <textarea id="decide-note" className={textareaControl} maxLength={1900} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
                </Field>
              ),
            } : c)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            {choice === "rate" ? <Button type="button" disabled={busy} onClick={() => void save("stay")}>Open the rate card</Button>
              : choice === "letter" && hand ? <Button type="button" disabled={busy} onClick={() => void save("stay")}>Open the letter</Button>
                : <>
                  <Button type="button" variant={nextName ? "outline" : "default"} disabled={busy || !choice} onClick={() => void save("stay")}>Save</Button>
                  {nextName && <Button type="button" disabled={busy || !choice} onClick={() => void save("next")}>Save and open {nextName}</Button>}
                </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
