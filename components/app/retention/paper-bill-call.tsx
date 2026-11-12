"use client";

import Link from "next/link";
import { NoteField } from "@/components/ui/note-field";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { control, Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ServicingRequestForm } from "@/components/app/retention/servicing-request-form";
import { fileDay } from "@/lib/ingestion/constants";
import { CONVERSION_OUTCOME_LABELS, type CampaignState } from "@/lib/retention/campaign";
import type { ConversionCall } from "@/lib/retention/campaignStore";
import { notify } from "@/lib/notify";

/**
 * Paper bill → bank, one call (the pick of 2026-11-05, "PbA"): the talk track read-only (it is edited in
 * Settings › Retention), then what happened as one set of answers — the old Log call and Start conversion
 * were two buttons for the same call. "Agreed" opens the bill-to-draft request in place; "Said no" asks
 * why; "No bank account" asks first, because the policy leaves the campaign for good.
 */
async function log(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "log_call", ...body }) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
}

type Answer = "agreed" | "declined" | null;

export function PaperBillCall({ carrierId, policyNumber, state, talkTrack, cooloffDays, nextHref, readOnly }: {
  carrierId: string;
  policyNumber: string;
  state: CampaignState;
  talkTrack: string;
  cooloffDays: number;
  nextHref: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState<Answer>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callable = state === "remaining" && !readOnly;
  const after = () => { if (nextHref) router.push(nextHref); else router.push("/app/servicing?view=campaign"); };

  async function quick(outcome: "no_answer" | "callback_requested" | "declined" | "unable_no_bank_account", text: string) {
    setBusy(true);
    setError(null);
    try {
      await log({ carrier_id: carrierId, policy_number: policyNumber, outcome, decline_reason: outcome === "declined" ? reason.trim() : null, note: note.trim() || null });
      notify.done(text);
      after();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function noBank() {
    const ok = await confirmAction({ title: "No bank account?", description: "They won't be asked again: the policy leaves the campaign for good and goes to the save queue, where its risk decides what else is worth trying.", confirmLabel: "Leave the campaign", cancelLabel: "Back" });
    if (ok) await quick("unable_no_bank_account", "Logged. It leaves the campaign and goes to the save queue.");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-label="Talk track">
        <h2 className="m-0 text-xs font-semibold text-muted-foreground">Talk track</h2>
        <div className="grid gap-3 text-sm text-foreground">{talkTrack.split(/\n{2,}/).map((p, i) => <p key={i} className="m-0">{p}</p>)}</div>
        <Link href="/app/retention-settings" className="text-xs text-muted-foreground hover:underline">Edited in Settings › Retention</Link>
      </section>

      {!callable ? (
        <TableCard><EmptyState title={state === "converted" ? "Converted" : state === "in_progress" ? "The switch is with the carrier" : "Not on the list to call now"} hint={state === "in_progress" ? "It counts as converted once a carrier file shows the bank draft." : state === "declined" ? "They said no; it comes back after the cooling-off." : state === "no_bank_account" ? "No bank account: it went to the save queue." : "Nothing to call about here now."} /></TableCard>
      ) : answer === "agreed" ? (
        <ServicingRequestForm carrierId={carrierId} policyNumber={policyNumber} type="bill_to_draft_conversion" origin="campaign" fromQueue={false} onCancel={() => setAnswer(null)} onDone={(id) => router.push(id ? `/app/servicing/${id}` : "/app/servicing?view=campaign")} />
      ) : (
        <section className={`${cardSurface} flex flex-col gap-4 p-5`} aria-label="What happened">
          <h2 className="m-0 text-xs font-semibold text-muted-foreground">What happened</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => setAnswer("agreed")}>Agreed: start the switch</Button>
            <Button type="button" variant={answer === "declined" ? "default" : "outline"} disabled={busy} onClick={() => setAnswer(answer === "declined" ? null : "declined")}>Said no</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void quick("no_answer", "Logged: no answer.")}>No answer</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void quick("callback_requested", "Logged: they asked for a call back.")}>Call back</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void noBank()}>No bank account</Button>
          </div>
          {answer === "declined" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Why they said no" htmlFor="pb-reason" required><input id="pb-reason" autoComplete="off" maxLength={500} className={control} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex items-end"><Button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void quick("declined", `Logged. It comes back to the list in ${cooloffDays} days.`)}>Log: said no</Button></div>
            </div>
          )}
          <Field label="Note (kept with the call)" htmlFor="pb-note"><NoteField id="pb-note"  maxLength={2000} value={note} onChange={setNote} /></Field>
          {/* On a page a Callout goes to the bell: an error the user must fix stays beside the buttons (§11). */}
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}
        </section>
      )}
    </div>
  );
}

export function PaperBillCalls({ calls }: { calls: ConversionCall[] }) {
  return (
    <TableCard footer={calls.length ? <span>{calls.length === 1 ? "1 call" : `${calls.length} calls`}, newest first</span> : undefined}>
      {calls.length === 0 ? <EmptyState title="No calls logged yet" hint="Each call about switching to bank payment shows here." /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th className="w-[120px]">When</th><th>What happened</th><th>Note</th><th className="w-[160px]">By</th></tr></thead>
          <tbody>
            {calls.map((c, i) => {
              // One line per call (owner 2026-11-11): why they said no joins the note; the request is the outcome's link.
              const said = CONVERSION_OUTCOME_LABELS[c.outcome] ?? c.outcome;
              const note = [c.declineReason, c.note].filter(Boolean).join(" · ");
              return (
                <tr key={`${c.at}-${i}`}>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(c.at.slice(0, 10))}</td>
                  <td className="whitespace-nowrap">{c.servicingRequestId ? <Link href={`/app/servicing/${c.servicingRequestId}`} className="hover:underline" title="Open the request">{said}</Link> : said}</td>
                  <td>{note ? <span className="block max-w-[420px] truncate" title={note}>{note}</span> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">{c.by ?? <span className="text-muted-foreground">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
