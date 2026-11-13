"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, checkboxControl, textareaControl } from "@/components/ui/field";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { notify } from "@/lib/notify";
import { payIssueLetterHref, payIssueMoney as money } from "@/lib/commissions/payIssueGroups";

import { READ_ONLY_HINT, postPayIssue } from "./check-now";
import { handLetterHref } from "./decide-dialog";

export type LetterCandidate = { id: string; policyNumber: string | null; clientName: string | null; owedCents: number; withinLag: boolean; unpriced: boolean };

type Draft = { body: string; totalCents: number; recipient: string | null } | null;

/**
 * The group's letter (round 7, 2·3, xl): who it goes to (saved as the carrier's address when ticked), the issues on
 * it with their ticks (choosing happens here, never in the table: the ones still inside the pay lag, or with no rate
 * to price them, start unticked and the dialog says so), and the letter itself, drafted from the records. "Save
 * letter" freezes it on Letters out and marks its issues "In a letter". Insurvas never sends it.
 *
 * Statements imported by hand keep their own printable letter page for now (it is not saved or listed on Letters
 * out: that needs the letters table to hold their findings, a database change), so their issues are ticked here and
 * the page opens with them.
 */
export function GroupLetterButton({ carrierId, carrierName, carrierItems, handItems, readOnly, label, variant = "default" }: {
  carrierId: string | null;
  carrierName: string;
  carrierItems: LetterCandidate[];
  handItems: LetterCandidate[];
  readOnly: boolean;
  label: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [handTicked, setHandTicked] = useState<string[]>([]);
  const [recipient, setRecipient] = useState("");
  const [saveAddress, setSaveAddress] = useState(false);
  const [draft, setDraft] = useState<Draft>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fallback = `${carrierName}\nCommissions Department`;

  async function preview(ids: string[], to: string | null) {
    if (!ids.length) { setDraft(null); return; }
    try {
      const data = await postPayIssue({ action: "preview_letter", ids, recipient: to });
      setDraft({ body: String(data.body ?? ""), totalCents: Number(data.totalCents ?? 0), recipient: (data.recipient as string | null) ?? null });
      setError(null);
      return data;
    } catch (reason) {
      setDraft(null);
      setError(reason instanceof Error ? reason.message : "The letter could not be drafted.");
    }
  }

  async function start() {
    const first = carrierItems.filter((i) => !i.withinLag && !i.unpriced).map((i) => i.id);
    setTicked(first);
    setHandTicked(handItems.filter((i) => !i.withinLag).map((i) => i.id));
    setSaveAddress(false);
    setError(null);
    setDraft(null);
    setRecipient("");
    setOpen(true);
    if (first.length) {
      const data = await preview(first, null);
      setRecipient(((data?.recipient as string | null) ?? null) ?? fallback);
    } else setRecipient(fallback);
  }

  function tick(id: string, on: boolean) {
    const next = on ? [...ticked, id] : ticked.filter((x) => x !== id);
    setTicked(next);
    void preview(next, recipient.trim() || null);
  }

  async function save() {
    if (!ticked.length) return;
    setBusy(true);
    try {
      const to = recipient.trim() || null;
      if (saveAddress && carrierId && to) {
        const response = await fetch("/api/app/discrepancies/carrier-contact", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrierId, address: to }) });
        if (!response.ok) notify.warn("The address was not saved for later letters.", { detail: ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "This letter still uses it." });
      }
      const data = await postPayIssue({ action: "draft_dispute", ids: ticked, recipient: to });
      const id = String(data.id ?? "");
      setOpen(false);
      refreshStepCounts();
      notify.done("Letter saved. Download it on Letters out, send it, then mark it sent.", id ? { action: { label: "Open it", onClick: () => router.push(payIssueLetterHref(id)) } } : undefined);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The letter could not be drafted.");
    } finally {
      setBusy(false);
    }
  }

  const leftOff = carrierItems.filter((i) => !ticked.includes(i.id)).length;
  const lagged = carrierItems.filter((i) => i.withinLag).length;
  const unpriced = carrierItems.filter((i) => i.unpriced).length;
  const row = (item: LetterCandidate, checked: boolean, onChange: (on: boolean) => void) => (
    <li key={item.id} className="flex h-9 items-center gap-3 border-b border-border px-3 last:border-b-0">
      <input type="checkbox" className={checkboxControl} checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} aria-label={`Put ${item.policyNumber ?? "this item"} on the letter`} />
      <span className={`min-w-0 flex-1 truncate text-sm ${checked ? "text-foreground" : "text-muted-foreground"}`}>
        <span className="tabular-nums">{item.policyNumber ?? "Whole account"}</span>{" · "}{item.withinLag ? "within the lag" : item.unpriced ? "no rate to price it" : item.clientName ?? "client not known"}
      </span>
      <span className={`text-right text-sm tabular-nums ${checked ? "text-foreground" : "text-muted-foreground"}`}>{item.unpriced ? "—" : money(item.owedCents)}</span>
    </li>
  );

  return (
    <>
      <span title={readOnly ? READ_ONLY_HINT : undefined}>
        <Button type="button" variant={variant} disabled={readOnly} onClick={() => void start()}>{label}</Button>
      </span>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent size="xl" className="max-h-[calc(100vh-4rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Dispute letter to {carrierName}{draft ? `: ${money(draft.totalCents)}` : ""}</DialogTitle>
            <DialogDescription>Drafted from the records, figure for figure. Insurvas never sends it: save it, download the PDF and send it yourself, then record what happened.</DialogDescription>
          </DialogHeader>

          {carrierItems.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`To (${carrierName}'s commissions department)`} htmlFor="letter-to">
                <textarea id="letter-to" rows={4} maxLength={600} className={textareaControl} value={recipient} disabled={busy} onChange={(e) => setRecipient(e.target.value)} onBlur={() => void preview(ticked, recipient.trim() || null)} />
                {carrierId && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" className={checkboxControl} checked={saveAddress} disabled={busy} onChange={(e) => setSaveAddress(e.target.checked)} />
                    Save as {carrierName}&apos;s address
                  </label>
                )}
              </Field>
              <div className="min-w-0">
                <span className="text-label text-[var(--body)]">On this letter</span>
                <ul className="mt-1.5 max-h-[180px] overflow-y-auto rounded-md border border-border">
                  {carrierItems.map((item) => row(item, ticked.includes(item.id), (on) => tick(item.id, on)))}
                </ul>
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  {ticked.length.toLocaleString("en-US")} ticked
                  {leftOff > 0 && ` · ${leftOff.toLocaleString("en-US")} left off`}
                  {lagged > 0 && ` (${lagged.toLocaleString("en-US")} within the pay lag)`}
                  {unpriced > 0 && ` · ${unpriced.toLocaleString("en-US")} with no rate start unticked`}
                </span>
              </div>
            </div>
          )}

          {carrierItems.length > 0 && (draft
            ? <pre className="m-0 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-[var(--surface-alt)] p-3 font-mono text-xs leading-relaxed text-foreground">{draft.body}</pre>
            : !error && <p className="m-0 text-sm text-muted-foreground">{ticked.length ? "Drafting the letter" : "Tick at least one issue to draft the letter."}</p>)}
          {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}

          {handItems.length > 0 && (
            <div className="min-w-0">
              <span className="text-label text-[var(--body)]">From statements imported by hand</span>
              <ul className="mt-1.5 max-h-[180px] overflow-y-auto rounded-md border border-border">
                {handItems.map((item) => row(item, handTicked.includes(item.id), (on) => setHandTicked(on ? [...handTicked, item.id] : handTicked.filter((x) => x !== item.id))))}
              </ul>
              <span className="mt-1.5 block text-xs text-muted-foreground">These print from their own letter page, with the address and the figures; it is not listed on Letters out.</span>
            </div>
          )}

          <DialogFooter className="sm:items-center">
            {carrierItems.length > 0 && <span className="mr-auto text-xs text-muted-foreground">Also marks the {ticked.length.toLocaleString("en-US")} {ticked.length === 1 ? "issue" : "issues"} &ldquo;In a letter&rdquo;</span>}
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            {handItems.length > 0 && carrierId && (
              <Button asChild type="button" variant={carrierItems.length ? "outline" : "default"} disabled={!handTicked.length}>
                <a href={handLetterHref(carrierId, handTicked)} target="_blank" rel="noreferrer" aria-disabled={!handTicked.length} onClick={(e) => { if (!handTicked.length) e.preventDefault(); }}>Open the printable letter ({handTicked.length})</a>
              </Button>
            )}
            {carrierItems.length > 0 && <Button type="button" disabled={busy || !ticked.length || !draft} onClick={() => void save()}>Save letter</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
