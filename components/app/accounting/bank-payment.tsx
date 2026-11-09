"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lagWords, POLICY_LABELS, type MoneyState, type PolicyState } from "@/lib/accounting/bankResultsCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * One carrier payment (round 1 boards B3 and B4, 2026-11-07): "Did the money land?" — the carrier's figure
 * beside the bank's, linked or not — then "Did they pay each policy right?" against the rate card. A full
 * page, never a side panel. The shorts are disputed (the LA-4.5 letter) or accepted; a missing payment can
 * be linked to its nearest deposit in one click, or matched by hand on To match.
 */
export type PaymentView = {
  id: string;
  carrierId: string;
  carrierName: string;
  statementDate: string;
  paidCents: number;
  money: MoneyState;
  dueBy: string;
  missingCents: number;
  bankThrough: string | null;
  deposits: { matchId: string; postedOn: string; appliedCents: number; descriptionRaw: string; account: string; confirmed: boolean }[];
  policies: { policyNumber: string; paidCents: number; rateBp: number | null; promisedCents: number | null; state: PolicyState; shortCents: number; findingId: string | null }[];
  nearest: { id: string; postedOn: string; amountCents: number; descriptionRaw: string; account: string } | null;
};

const money = (c: number) => formatCentsAsCurrency(c);
/** Basis points as a percent, by string (no float): 8000 → "80%", 8050 → "80.5%". */
function pct(bp: number | null) {
  if (bp === null) return "—";
  const d = String(Math.abs(bp)).padStart(3, "0");
  const frac = d.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${d.slice(0, -2)}${frac ? `.${frac}` : ""}%`;
}
const TONE: Record<PolicyState, "good" | "danger" | "warning" | "neutral"> = { ok: "good", short: "danger", over: "warning", no_promise: "neutral" };

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** The title line's buttons: dispute the shorts (primary), or accept them as paid. */
export function PaymentActions({ p, readOnly }: { p: PaymentView; readOnly: boolean }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const shorts = p.policies.filter((x) => x.state === "short" && x.findingId);
  if (!shorts.length) {
    if (p.money === "missing" || p.money === "waiting" || p.money === "to_confirm") return <Button asChild variant={p.money === "missing" ? "default" : "outline"}><Link href="/app/bank?view=queue">Match a deposit by hand</Link></Button>;
    return null;
  }
  const accept = async () => {
    try {
      for (const s of shorts) await post("/api/app/commission-discrepancies", { action: "set_status", id: s.findingId, status: "accepted", note: `Accepted as paid from ${p.carrierName} · ${p.statementDate} on Bank deposits.` });
      notify.done(shorts.length === 1 ? "Accepted as paid" : `${shorts.length} policies accepted as paid`);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    }
  };
  // LA-4.15's letter: its text is frozen as a draft and the shorts are marked disputed. Nothing is sent; it waits
  // under Discrepancies › Letters out, with its PDF.
  const draft = async () => {
    setDrafting(true);
    try {
      await post("/api/app/commission-discrepancies", { action: "draft_dispute", ids: shorts.map((s) => s.findingId), recipient: null });
      notify.done(`Dispute letter drafted for ${money(shorts.reduce((n, s) => n + s.shortCents, 0))}. Nothing is sent yet.`);
      router.push("/app/discrepancies?view=letters");
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
      setDrafting(false);
    }
  };
  return (
    <>
      {!readOnly ? <Button variant="outline" onClick={() => setAccepting(true)}>Accept as paid</Button> : null}
      {!readOnly ? <Button disabled={drafting} onClick={() => void draft()}>{drafting ? "Drafting…" : "Draft dispute letter"}</Button> : null}
      <ConfirmDialog
        open={accepting}
        onOpenChange={setAccepting}
        title={`Accept ${money(shorts.reduce((n, s) => n + s.shortCents, 0))} short as paid?`}
        description={`${shorts.length === 1 ? "This policy stops" : `These ${shorts.length} policies stop`} counting as bad math. Use this when the carrier was right, for example a rate change you agreed to.`}
        confirmLabel="Accept as paid"
        destructive={false}
        onConfirm={accept}
      />
    </>
  );
}

export function PaymentBody({ p, readOnly }: { p: PaymentView; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const landed = p.deposits.reduce((n, d) => n + d.appliedCents, 0);
  const act = async (body: unknown, done: string) => {
    setBusy(true);
    try {
      await post("/api/app/accounting/bank", body);
      notify.done(done);
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const shortTotal = p.policies.reduce((n, x) => n + x.shortCents, 0);
  const sideBox = "flex min-w-0 flex-col gap-0.5 rounded-[10px] bg-[var(--surface-sunken)] p-4";
  const figure = "font-[family-name:var(--font-display)] text-xl font-bold tabular-nums text-[var(--ink)]";

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-[var(--color-card)] p-5">
        <h2 className="m-0 text-base font-semibold text-[var(--ink)]">1 · Did the money land?</h2>
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className={sideBox}><span className="text-xs text-muted-foreground">Carrier said they paid</span><span className={figure}>{money(p.paidCents)}</span><span className="text-xs text-muted-foreground">{p.statementDate}</span></div>
          <span aria-label={p.money === "landed" ? "Linked" : "Not linked"} className={`grid size-10 place-items-center justify-self-center rounded-full text-base font-bold ${p.money === "landed" ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : p.money === "missing" ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-muted text-muted-foreground"}`}>{p.money === "landed" ? "✓" : p.money === "missing" ? "!" : "…"}</span>
          <div className={p.money === "missing" ? `${sideBox} !bg-[var(--error-surface)]` : sideBox}>
            <span className="text-xs text-muted-foreground">Bank shows</span>
            <span className={p.money === "missing" ? `${figure} !text-[var(--error-ink)]` : figure}>{p.deposits.length ? money(landed) : "Nothing"}</span>
            <span className="text-xs text-muted-foreground">
              {p.deposits.length
                ? p.deposits.map((d) => `${d.postedOn} · ${d.account} · ${lagWords(p.statementDate, d.postedOn)}${d.confirmed ? "" : " · suggested"}`).join("; ")
                : p.money === "missing" ? `Looked from ${p.statementDate} to ${p.dueBy}` : p.bankThrough && p.bankThrough < p.dueBy ? `Your bank file reaches ${p.bankThrough}; the deposit is due by ${p.dueBy}` : `Due by ${p.dueBy}`}
            </span>
          </div>
        </div>
        {p.deposits.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {p.deposits.map((d) => (
              <li key={d.matchId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><span className="font-mono text-xs">{d.descriptionRaw}</span> <span className="text-muted-foreground">· {money(d.appliedCents)}{d.confirmed ? "" : " · suggested, not confirmed"}</span></span>
                {!readOnly ? <span className="flex gap-1">
                  {!d.confirmed ? <Button size="sm" disabled={busy} onClick={() => void act({ op: "confirm", match_ids: [d.matchId] }, "Confirmed")}>Confirm</Button> : null}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ op: "remove", match_id: d.matchId }, d.confirmed ? "Unlinked" : "Suggestion declined")}>{d.confirmed ? "Unlink" : "Decline"}</Button>
                </span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {p.money === "missing" && p.nearest ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Closest: {money(p.nearest.amountCents)} on {p.nearest.postedOn} (&ldquo;{p.nearest.descriptionRaw}&rdquo;, {p.nearest.account}). {p.nearest.amountCents < p.paidCents ? `${money(p.paidCents - p.nearest.amountCents)} less` : p.nearest.amountCents > p.paidCents ? `${money(p.nearest.amountCents - p.paidCents)} more` : "The same amount"} than the carrier said.</span>
            {!readOnly ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ op: "manual", transaction_id: p.nearest!.id, statement_id: p.id, amount_cents: Math.min(p.nearest!.amountCents, p.paidCents - landed) }, "Linked")}>Link it anyway</Button> : null}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-[var(--color-card)] p-5">
        <h2 className="m-0 text-base font-semibold text-[var(--ink)]">2 · Did they pay each policy right?</h2>
        {p.policies.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No policy lines for this payment yet. They come from the carrier&apos;s commission file; <Link className="underline" href="/app/bank/check">drop it in</Link> to check each policy.</p>
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead className="text-right">Promised rate</TableHead><TableHead className="text-right">Should pay</TableHead><TableHead className="text-right">They paid</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="w-[170px]">Check</TableHead></TableRow></TableHeader>
            <TableBody>
              {p.policies.map((x) => (
                <TableRow key={x.policyNumber}>
                  <TableCell className="font-mono text-xs">{x.policyNumber}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(x.rateBp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.promisedCents === null ? "—" : money(x.promisedCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.paidCents)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${x.shortCents ? "font-semibold text-[var(--error-ink)]" : ""}`}>{x.shortCents ? `−${money(x.shortCents)}` : x.state === "no_promise" ? "—" : money(0)}</TableCell>
                  <TableCell><StatusChip tone={TONE[x.state]}>{POLICY_LABELS[x.state]}</StatusChip></TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold"><TableCell>{p.policies.length} {p.policies.length === 1 ? "policy" : "policies"}</TableCell><TableCell /><TableCell /><TableCell className="text-right tabular-nums">{money(p.policies.reduce((n, x) => n + x.paidCents, 0))}</TableCell><TableCell className={`text-right tabular-nums ${shortTotal ? "text-[var(--error-ink)]" : ""}`}>{shortTotal ? `−${money(shortTotal)}` : money(0)}</TableCell><TableCell /></TableRow>
            </TableBody>
          </Table>
        )}
        {p.policies.some((x) => x.state === "no_promise") ? <p className="m-0 text-xs text-muted-foreground">&ldquo;No promise on file&rdquo; means your rate card has no rate for that product, so it can&apos;t be checked. <Link className="underline" href="/app/rate-card">Add it on Rate card</Link>.</p> : null}
      </section>
    </div>
  );
}
