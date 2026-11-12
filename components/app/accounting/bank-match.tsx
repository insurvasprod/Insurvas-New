"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { StatusChip } from "@/components/ui/status-chip";
import { manualAmountProblem, readableDay, shortDay } from "@/lib/accounting/bankResultsCore";
import type { MatchStatus } from "@/lib/accounting/bankLabels";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * The Match dialog (round 7, board 1·6, Dialog lg): every decision on a bank line, in one place, where the row
 * used to hold up to five buttons. Confirm the suggestion (or another open statement), decline it, match by hand
 * (a statement and an amount, never more than the deposit has open), or say it isn't carrier money (with a
 * reason). Stepping ("1 of N", from Match N one by one) adds Confirm and next. A matched line opens read-only with
 * Unlink; a line set aside opens with its reason. Read-only accounts see the facts and Close.
 */
export type Match = { id: string; statementId: string; carrierName: string; statementDate: string; amountAppliedCents: number; confidence: string; confirmed: boolean; confirmedAt: string | null; reason: string | null };
export type Txn = { id: string; accountId: string; postedOn: string; amountCents: number; descriptionRaw: string; reference: string | null; status: MatchStatus; ignoredReason: string | null; matches: Match[] };
export type Stmt = { id: string; carrierName: string; statementDate: string; paidCents: number; receivedCents: number };

export async function postBank(body: unknown) {
  const res = await fetch("/api/app/accounting/bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

const money = (c: number) => formatCentsAsCurrency(c);
const failed = (err: unknown) => notify.fail(err instanceof Error && err.message !== "That didn't save" ? err.message : "That didn't save", { detail: "Try again; nothing changed." });

type Candidate = { key: string; label: string; sub: string; cents: number; match?: Match; statement?: Stmt };

export function BankMatchDialog({ txn, account, statements, readOnly, step, onClose, onChanged, onNext }: {
  txn: Txn;
  account: string;
  statements: Stmt[];
  readOnly: boolean;
  step: { at: number; total: number } | null;
  onClose: () => void;
  onChanged: () => void;
  /** Stepping and not at the last line: move on after a decision. */
  onNext?: () => void;
}) {
  const confirmed = txn.matches.filter((m) => m.confirmed);
  const pending = txn.matches.filter((m) => !m.confirmed);
  const appliedCents = confirmed.reduce((s, m) => s + m.amountAppliedCents, 0);
  const openCents = Math.max(0, txn.amountCents - appliedCents);
  const settled = txn.status === "matched" || txn.status === "ignored";
  // The suggestions first, then the open statements closest in amount to what is left (up to three).
  const taken = new Set(txn.matches.map((m) => m.statementId));
  const others = statements.filter((s) => !taken.has(s.id) && s.paidCents > s.receivedCents)
    .sort((a, b) => Math.abs(a.paidCents - a.receivedCents - openCents) - Math.abs(b.paidCents - b.receivedCents - openCents)).slice(0, 3);
  const candidates: Candidate[] = [
    ...pending.map((m) => ({ key: m.id, label: `${m.carrierName} · statement ${readableDay(m.statementDate)}`, sub: `${m.reason ?? "suggested"} · suggested`, cents: m.amountAppliedCents, match: m })),
    ...others.map((s) => ({ key: s.id, label: `${s.carrierName} · statement ${readableDay(s.statementDate)}`, sub: `${money(s.paidCents - s.receivedCents)} open`, cents: Math.min(openCents, s.paidCents - s.receivedCents), statement: s })),
  ];
  const [mode, setMode] = useState<"suggest" | "manual" | "ignore">("suggest");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(pending.map((m) => m.id)));
  const [manual, setManual] = useState({ statement: "", amount: formatCentsAsCurrency(openCents).replace(/[$,]/g, "") });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const stepping = step !== null;
  const last = !onNext;
  const after = () => { onChanged(); if (onNext) onNext(); else onClose(); };

  const confirm = async (andNext: boolean) => {
    const chosen = candidates.filter((c) => picked.has(c.key));
    if (!chosen.length) return;
    setBusy(true);
    try {
      const matchIds = chosen.filter((c) => c.match).map((c) => c.match!.id);
      const made: string[] = [...matchIds];
      if (matchIds.length) await postBank({ op: "confirm", match_ids: matchIds });
      let left = openCents - chosen.filter((c) => c.match).reduce((s, c) => s + c.cents, 0);
      for (const c of chosen.filter((x) => x.statement)) {
        const cents = Math.min(left, c.cents);
        if (cents <= 0) break;
        const json = await postBank({ op: "manual", transaction_id: txn.id, statement_id: c.statement!.id, amount_cents: cents });
        if (json?.result) made.push(String(json.result));
        left -= cents;
      }
      notify.done("Confirmed", {
        detail: `${txn.descriptionRaw} matched to ${chosen.map((c) => c.label.replace(" · statement ", " ")).join(", ")}.`,
        action: { label: "Undo", onClick: () => void Promise.all(made.map((id) => postBank({ op: "remove", match_id: id }))).then(onChanged, failed) },
      });
      if (andNext) after(); else { onChanged(); onClose(); }
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      for (const m of pending) await postBank({ op: "remove", match_id: m.id });
      notify.done(pending.length === 1 ? "Suggestion declined" : `${pending.length} suggestions declined`, { detail: "The deposit stays on To match. Suggest matches again can bring it back." });
      onChanged();
      setPicked(new Set());
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const manualCents = parseDollarsToCents(manual.amount);
  const manualProblem = manual.amount.trim() ? manualAmountProblem(manualCents, openCents) : null;
  const matchByHand = async () => {
    if (!manual.statement || manualProblem || manualCents === null) return;
    setBusy(true);
    try {
      const json = await postBank({ op: "manual", transaction_id: txn.id, statement_id: manual.statement, amount_cents: manualCents });
      const s = statements.find((x) => x.id === manual.statement);
      notify.done("Matched", {
        detail: `${money(manualCents)} of ${txn.descriptionRaw} to ${s ? `${s.carrierName} ${shortDay(s.statementDate)}` : "the statement"}.`,
        action: json?.result ? { label: "Undo", onClick: () => void postBank({ op: "remove", match_id: String(json.result) }).then(onChanged, failed) } : undefined,
      });
      after();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const setAside = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await postBank({ op: "ignore", transaction_id: txn.id, reason: reason.trim() });
      notify.done("Set aside: not carrier money", { action: { label: "Undo", onClick: () => void postBank({ op: "unignore", transaction_id: txn.id }).then(onChanged, failed) } });
      after();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const unignore = async () => {
    setBusy(true);
    try {
      await postBank({ op: "unignore", transaction_id: txn.id });
      notify.done("Back on To match", { action: { label: "Undo", onClick: () => void postBank({ op: "ignore", transaction_id: txn.id, reason: txn.ignoredReason ?? "Not carrier money" }).then(onChanged, failed) } });
      onChanged();
      onClose();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (m: Match) => {
    const ok = await confirmAction({
      title: "Unlink this deposit?",
      description: `The ${money(m.amountAppliedCents)} goes back to Deposits › To match, and ${m.carrierName} ${shortDay(m.statementDate)} waits for its money again.`,
      confirmLabel: "Unlink",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await postBank({ op: "remove", match_id: m.id });
      notify.done("Unlinked", {
        detail: `${txn.descriptionRaw} is back on To match.`,
        action: { label: "Undo", onClick: () => void postBank({ op: "manual", transaction_id: txn.id, statement_id: m.statementId, amount_cents: m.amountAppliedCents }).then(onChanged, failed) },
      });
      onChanged();
      onClose();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const facts = [readableDay(txn.postedOn), account, txn.reference ? `ref ${txn.reference}` : null, !txn.matches.length && txn.status !== "ignored" ? "nothing explains it" : null].filter(Boolean).join(" · ");
  const toggle = (key: string) => setPicked((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const link = "text-sm font-medium text-[var(--accent-ink)] hover:underline disabled:opacity-40";

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size={"lg"}>
        <DialogHeader>
          <div className="flex items-baseline gap-3 pr-8">
            <DialogTitle className="min-w-0 truncate"><span className="font-mono">{txn.descriptionRaw}</span> · {money(txn.amountCents)}</DialogTitle>
            {stepping ? <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{step.at + 1} of {step.total}</span> : null}
          </div>
          <DialogDescription>{mode === "ignore" ? "It stays on the statement, set aside with your reason. You can match it later." : facts}</DialogDescription>
        </DialogHeader>

        {settled || readOnly ? (
          <>
            <div className="flex flex-col gap-2 text-sm">
              {txn.status === "ignored" ? <p className="m-0"><StatusChip tone="neutral">Not carrier money</StatusChip> <span className="text-muted-foreground">{txn.ignoredReason}</span></p> : null}
              {confirmed.map((m) => (
                <div key={m.id} className="m-content-in flex flex-wrap items-center justify-between gap-2">
                  <span><StatusChip tone="good">Matched</StatusChip> to {m.carrierName} · {readableDay(m.statementDate)} · {money(m.amountAppliedCents)}{m.confirmedAt ? <span className="text-muted-foreground"> · confirmed {shortDay(m.confirmedAt)}</span> : null}</span>
                  <Link className={link} href={`/app/bank/payments/${m.statementId}?tab=deposit`}>Open the payment ›</Link>
                </div>
              ))}
              {pending.map((m) => <div key={m.id} className="m-content-in text-muted-foreground">Suggested: {m.carrierName} · {readableDay(m.statementDate)} · {money(m.amountAppliedCents)}</div>)}
              {!txn.matches.length && txn.status !== "ignored" ? <p className="m-0 text-muted-foreground">Nothing explains it yet.</p> : null}
            </div>
            <DialogFooter className="sm:justify-between">
              <span className="flex gap-2">
                {!readOnly && confirmed.map((m) => <Button key={m.id} variant="destructive" disabled={busy} onClick={() => void unlink(m)}>{confirmed.length > 1 ? `Unlink ${m.carrierName}` : "Unlink"}</Button>)}
                {!readOnly && txn.status === "ignored" ? <Button variant="outline" disabled={busy} onClick={() => void unignore()}>It is carrier money</Button> : null}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" onClick={onClose} title={readOnly ? "Paused while the account is read-only." : undefined}>Close</Button>
                {stepping && onNext ? <Button onClick={onNext}>Next ›</Button> : null}
              </span>
            </DialogFooter>
          </>
        ) : mode === "manual" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Statement" htmlFor="bank-manual-statement">
                <select id="bank-manual-statement" className={control} value={manual.statement} onChange={(e) => setManual({ ...manual, statement: e.target.value })}>
                  <option value="">Choose…</option>
                  {statements.map((s) => <option key={s.id} value={s.id}>{s.carrierName} {shortDay(s.statementDate)}, {s.statementDate.slice(0, 4)} — {money(s.paidCents - s.receivedCents)} open</option>)}
                </select>
              </Field>
              <Field label="Amount" htmlFor="bank-manual-amount" error={manualProblem}><input id="bank-manual-amount" className={control} inputMode="decimal" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></Field>
            </div>
            <p className="m-0 flex gap-3 text-sm"><button type="button" className={link} onClick={() => setMode("suggest")}>‹ Back to the suggestions</button><button type="button" className={link} onClick={() => setMode("ignore")}>It isn&apos;t carrier money</button></p>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button disabled={busy || !manual.statement || !!manualProblem || manualCents === null} onClick={() => void matchByHand()}>{busy ? "Matching…" : stepping && !last ? "Match and next ›" : "Match"}</Button>
            </DialogFooter>
          </>
        ) : mode === "ignore" ? (
          <>
            <Field label="Why it isn't carrier money" htmlFor="bank-ignore-reason"><input id="bank-ignore-reason" className={control} autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner's own transfer" /></Field>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" disabled={busy} onClick={() => setMode("suggest")}>‹ Back</Button>
              <span className="flex gap-2">
                <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
                <Button disabled={busy || !reason.trim()} onClick={() => void setAside()}>{busy ? "Setting aside…" : "Set it aside"}</Button>
              </span>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="m-0 text-xs font-medium text-muted-foreground">What it pays{appliedCents ? ` · ${money(appliedCents)} already matched, ${money(openCents)} open` : ""}</p>
              {candidates.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {candidates.map((c) => (
                    <li key={c.key}>
                      <div className="m-content-in">
                        <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[var(--surface-alt)]">
                          <input type="checkbox" className="mt-1" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
                          <span className="min-w-0 flex-1 text-sm"><span className={c.match ? "font-medium" : ""}>{c.label}</span><span className="block text-xs text-muted-foreground">{c.sub}</span></span>
                          <span className="text-sm tabular-nums text-muted-foreground">{money(c.cents)}</span>
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 text-sm text-muted-foreground">No open carrier statement to match it to.</p>}
              <p className="m-0 flex gap-3 text-sm"><button type="button" className={link} onClick={() => setMode("manual")}>Match by hand</button><button type="button" className={link} onClick={() => setMode("ignore")}>It isn&apos;t carrier money</button></p>
            </div>
            <DialogFooter className="sm:justify-between">
              {pending.length ? <Button variant="ghost" disabled={busy} onClick={() => void decline()}>Decline the suggestion</Button> : stepping && onNext ? <Button variant="ghost" disabled={busy} onClick={onNext}>Skip ›</Button> : <span />}
              <span className="flex gap-2">
                {stepping && !last ? (
                  <>
                    <Button variant="outline" disabled={busy || picked.size === 0} onClick={() => void confirm(false)}>Confirm</Button>
                    <Button disabled={busy || picked.size === 0} onClick={() => void confirm(true)}>Confirm and next ›</Button>
                  </>
                ) : <Button disabled={busy || picked.size === 0} onClick={() => void confirm(false)}>{busy ? "Confirming…" : "Confirm"}</Button>}
              </span>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
