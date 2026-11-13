"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PausedButton } from "@/components/app/accounting/bank-board";
import { postBank } from "@/components/app/accounting/bank-match";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { daysBetween, lagWords, POLICY_LABELS, readableDay, shortDay, VERDICT_LABELS, type MoneyState, type PaymentVerdict, type PolicyState } from "@/lib/accounting/bankResultsCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * One carrier payment (round 1 boards B3/B4, 2026-11-07; round 7 boards 1·3, 1·4 and 1·8, owner 2026-11-10). The
 * title alone ("Aflac · Sep 1, 2026 statement"), the figures as one strip, and three tabs: Policies (each policy
 * against the rate card; a row opens its dialog, which can accept just that one), The deposit (did the money land:
 * a linked line unlinks behind a confirm, the closest line links behind a confirm) and Letters (the dispute letters
 * drafted from this payment). A full page, never a side panel. The title line's ‹ › name the neighbouring payments.
 */
export type PaymentView = {
  id: string;
  carrierId: string;
  carrierName: string;
  statementDate: string;
  paidCents: number;
  money: MoneyState;
  verdict: PaymentVerdict;
  dueBy: string;
  missingCents: number;
  shortCents: number;
  bankThrough: string | null;
  deposits: { matchId: string; transactionId: string; postedOn: string; appliedCents: number; descriptionRaw: string; account: string; confirmed: boolean }[];
  policies: { policyNumber: string; href: string; paidCents: number; rateBp: number | null; promisedCents: number | null; state: PolicyState; shortCents: number; findingId: string | null }[];
  nearest: { id: string; postedOn: string; amountCents: number; descriptionRaw: string; account: string } | null;
  letters: { id: string; createdAt: string; status: string; totalCents: number; items: number }[];
};
export type PaymentTab = "policies" | "deposit" | "letters";

const money = (c: number) => formatCentsAsCurrency(c);
/** Basis points as a percent, by string (no float): 8000 → "80%", 8050 → "80.5%". */
function pct(bp: number | null) {
  if (bp === null) return "—";
  const d = String(Math.abs(bp)).padStart(3, "0");
  const frac = d.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${d.slice(0, -2)}${frac ? `.${frac}` : ""}%`;
}
const TONE: Record<PolicyState, "good" | "danger" | "warning" | "neutral"> = { ok: "good", short: "danger", over: "warning", no_promise: "neutral" };
const RESULT_WORDS: Record<PaymentVerdict, string> = {
  missing_money: "nothing landed in the window",
  bad_math: "the money landed; the math is wrong",
  to_confirm: "a deposit waits to be confirmed",
  waiting: "the bank file doesn't reach the due date yet",
  rate_missing: "a policy has no rate on file",
  all_good: "landed, every policy paid right",
};
const LETTER_STATUS: Record<string, string> = { draft: "Draft · not sent", sent: "Sent", acknowledged: "Acknowledged", resolved: "Resolved", closed: "Closed" };
const failed = (err: unknown) => notify.fail(err instanceof Error && err.message !== "That didn't save" ? err.message : "That didn't save", { detail: "Try again; nothing changed." });

async function postDiscrepancy(body: unknown) {
  const res = await fetch("/api/app/commission-discrepancies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}
const setFinding = (id: string, status: "accepted" | "open", note: string | null) => postDiscrepancy({ action: "set_status", id, status, note });

/** The title line's buttons after the stepper: Accept as paid (confirm) and Draft dispute letter (primary), or Link a deposit. */
export function PaymentActions({ p, readOnly, lettersHref }: { p: PaymentView; readOnly: boolean; lettersHref: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [busy, setBusy] = useState(false);
  const shorts = p.policies.filter((x) => x.state === "short" && x.findingId);
  if (!shorts.length) {
    if (p.money !== "missing" && p.money !== "to_confirm") return null;
    return readOnly ? <PausedButton>Link a deposit</PausedButton> : <Button asChild><Link href="/app/bank?view=deposits&show=to_match">Link a deposit</Link></Button>;
  }
  if (readOnly) return <><PausedButton variant="outline">Accept as paid</PausedButton><PausedButton>Draft dispute letter</PausedButton></>;
  const total = shorts.reduce((n, s) => n + s.shortCents, 0);
  const accept = async () => {
    setBusy(true);
    try {
      for (const s of shorts) await setFinding(s.findingId!, "accepted", `Accepted as paid from ${p.carrierName} · ${p.statementDate} on Bank deposits.`);
      setAccepting(false);
      notify.done(shorts.length === 1 ? "Accepted as paid" : `${shorts.length} policies accepted as paid`, {
        action: { label: "Undo", onClick: () => void Promise.all(shorts.map((s) => setFinding(s.findingId!, "open", null))).then(() => router.refresh(), failed) },
      });
      router.refresh();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  // LA-4.15's letter: its text is frozen as a draft and the shorts are marked disputed. Nothing is sent; it waits on
  // this payment's Letters tab and under Discrepancies › Letters out, with its PDF.
  const draft = async () => {
    setBusy(true);
    try {
      await postDiscrepancy({ action: "draft_dispute", ids: shorts.map((s) => s.findingId), recipient: null });
      notify.done(`Dispute letter drafted for ${money(total)}. Nothing is sent yet.`, { action: { label: "Open", onClick: () => router.push("/app/discrepancies?view=letters") } });
      router.push(lettersHref);
      router.refresh();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => setAccepting(true)}>Accept as paid</Button>
      <Button disabled={busy} onClick={() => void draft()}>{busy ? "Drafting…" : "Draft dispute letter"}</Button>
      <ConfirmDialog
        open={accepting}
        onOpenChange={setAccepting}
        busy={busy}
        title={`Accept ${money(total)} short as paid?`}
        description={`${shorts.length === 1 ? "This policy stops" : `These ${shorts.length} policies stop`} counting as bad math. Use this when the carrier was right, for example a rate change you agreed to.`}
        confirmLabel="Accept as paid"
        cancelLabel="Keep checking"
        destructive={false}
        onConfirm={() => void accept()}
      />
    </>
  );
}

/** The figures, as one strip (they were the facts line): what the carrier says, what the bank shows, the promise, the short, the verdict. */
export function PaymentStrip({ p, base }: { p: PaymentView; /** The page's own address with its `?from=`; each tile opens a tab of it. */ base: string }) {
  const tabHref = (tab: PaymentTab, show?: string) => `${base}&tab=${tab}${show ? `&show=${show}` : ""}`;
  const landed = p.deposits.reduce((n, d) => n + d.appliedCents, 0);
  const promised = p.policies.reduce((n, x) => n + (x.promisedCents ?? 0), 0);
  const shortCount = p.policies.filter((x) => x.state === "short").length;
  const first = p.deposits[0];
  return (
    <StatStrip label="This payment">
      <StatTile label="Carrier says" value={money(p.paidCents)} footnote={`statement ${readableDay(p.statementDate)}`} href={tabHref("policies")} />
      <StatTile label="Bank shows" value={p.deposits.length ? money(landed) : "Nothing"} footnote={first ? `${shortDay(first.postedOn)} · ${lagWords(p.statementDate, first.postedOn)}${first.confirmed ? "" : " · to confirm"}` : p.money === "missing" ? <StatusChip tone="danger">Missing · due by {shortDay(p.dueBy)}</StatusChip> : `due by ${shortDay(p.dueBy)}`} href={tabHref("deposit")} />
      <StatTile label="Should have paid" value={p.policies.some((x) => x.promisedCents !== null) ? money(promised) : "—"} footnote="by your rate card" href={tabHref("policies")} />
      <StatTile label="Short" value={money(p.shortCents)} footnote={p.shortCents ? <StatusChip tone="danger">{shortCount} {shortCount === 1 ? "policy" : "policies"}</StatusChip> : `${shortCount} ${shortCount === 1 ? "policy" : "policies"}`} href={tabHref("policies", "short")} />
      <StatTile label="Result" value={VERDICT_LABELS[p.verdict]} valueSize="text" footnote={RESULT_WORDS[p.verdict]} />
    </StatStrip>
  );
}

const POLICY_FILTERS = ["all", "short", "right", "no_promise"] as const;
type PolicyFilter = (typeof POLICY_FILTERS)[number];
const inPolicyFilter = (state: PolicyState, f: PolicyFilter) => f === "all" || (f === "short" ? state === "short" : f === "right" ? state === "ok" || state === "over" : state === "no_promise");

/** Policies (board 1·3): each policy against the rate card; a row opens its dialog (board 1·8). */
export function PaymentPolicies({ p, readOnly, show }: { p: PaymentView; readOnly: boolean; show?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<PolicyFilter>(POLICY_FILTERS.find((f) => f === show) ?? (p.policies.some((x) => x.state === "short") ? "short" : "all"));
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(620, 52);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = p.policies.filter((x) => inPolicyFilter(x.state, filter)).filter((x) => !needle || x.policyNumber.toLowerCase().includes(needle));
  const paged = paginate(shown, page, pageSize);
  const count = (f: PolicyFilter) => p.policies.filter((x) => inPolicyFilter(x.state, f)).length;
  const pick = (f: PolicyFilter) => { setFilter(f); setPage(1); setParamsInPlace({ show: f }); };
  const diff = shown.reduce((n, x) => n + x.shortCents, 0);
  const open = openAt === null ? null : shown[openAt];
  const acceptOne = async (x: PaymentView["policies"][number]) => {
    if (!x.findingId) return;
    setBusy(true);
    try {
      await setFinding(x.findingId, "accepted", `Accepted as paid from ${p.carrierName} · ${p.statementDate} on Bank deposits.`);
      notify.done("Accepted as paid", { detail: `${x.policyNumber} stops counting as bad math.`, action: { label: "Undo", onClick: () => void setFinding(x.findingId!, "open", null).then(() => router.refresh(), failed) } });
      router.refresh();
      setOpenAt(null);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  if (p.policies.length === 0) {
    return <TableCard><EmptyState title="No policy lines for this payment yet" hint="They come from the carrier's commission file. Drop it in on Check a payment to check each policy." action={<Button asChild variant="outline"><Link href="/app/bank/check">Check a payment</Link></Button>} /></TableCard>;
  }
  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search policy" />
            <Segmented label="Check" value={filter} onChange={pick} options={[
              { key: "all", label: "All", count: p.policies.length },
              { key: "short", label: "Short", count: count("short") || null, tone: "danger" },
              { key: "right", label: "Right", count: count("right") || null },
              { key: "no_promise", label: "No promise", count: count("no_promise") || null },
            ]} />
          </DataToolbar>
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{p.policies.some((x) => x.state === "no_promise") ? <>&ldquo;No promise on file&rdquo; means your rate card has no rate for that product. <Link className="font-medium hover:underline" href="/app/rate-card">Rate card ›</Link></> : null}</span>
            {shown.length > pageSize ? <Pager page={paged.current} total={shown.length} noun="policies" pageSize={pageSize} onPage={setPage} /> : <span className="tabular-nums">{shown.length} of {p.policies.length} policies{diff ? ` · −${money(diff)}` : ""}</span>}
          </div>
        }
      >
        {shown.length === 0 ? <NoMatches noun="policies" onClear={() => { setQ(""); pick("all"); }} /> : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th>Policy</th><th className="text-right">Promised rate</th><th className="text-right">Should pay</th><th className="text-right">They paid</th><th className="text-right">Difference</th><th>Check</th></tr></thead>
            <tbody>
              {paged.rows.map((x) => (
                // One line, one colour (owner 2026-11-11): a short policy says its money in the chip; the Difference stays plain.
                <tr key={x.policyNumber} className="cursor-pointer" onClick={() => setOpenAt(shown.indexOf(x))}>
                  <td className="whitespace-nowrap font-medium tabular-nums text-foreground"><Link className="hover:underline" href={x.href} onClick={(e) => e.stopPropagation()}>{x.policyNumber}</Link></td>
                  <td className="whitespace-nowrap text-right tabular-nums">{pct(x.rateBp)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{x.promisedCents === null ? <span className="text-muted-foreground">—</span> : money(x.promisedCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(x.paidCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{x.shortCents ? `−${money(x.shortCents)}` : x.state === "no_promise" ? <span className="text-muted-foreground">—</span> : money(0)}</td>
                  <td><StatusChip tone={TONE[x.state]}>{x.state === "short" && x.shortCents ? `${money(x.shortCents)} short` : POLICY_LABELS[x.state]}</StatusChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
      {open ? (
        <Dialog open onOpenChange={(next) => { if (!next && !busy) setOpenAt(null); }}>
          <DialogContent>
            <DialogHeader>
              <div className="flex items-baseline gap-3 pr-8">
                <DialogTitle className="font-mono">{open.policyNumber}</DialogTitle>
                {shown.length > 1 ? <span className="ml-auto text-xs text-muted-foreground tabular-nums">{openAt! + 1} of {shown.length}</span> : null}
              </div>
              <DialogDescription>{p.carrierName} · statement {readableDay(p.statementDate)}</DialogDescription>
            </DialogHeader>
            <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Promised</dt><dd className="m-0">{open.rateBp === null ? "No rate on file" : pct(open.rateBp)}</dd>
              <dt className="text-muted-foreground">Should pay</dt><dd className="m-0 tabular-nums">{open.promisedCents === null ? "—" : money(open.promisedCents)}</dd>
              <dt className="text-muted-foreground">They paid</dt><dd className="m-0 tabular-nums">{money(open.paidCents)}{open.paidCents === 0 ? ` · no line in the ${shortDay(p.statementDate)} file` : ""}</dd>
              <dt className="text-muted-foreground">Difference</dt><dd className={`m-0 tabular-nums ${open.shortCents ? "font-semibold text-[var(--error-ink)]" : ""}`}>{open.shortCents ? `−${money(open.shortCents)}` : POLICY_LABELS[open.state]}</dd>
            </dl>
            <DialogFooter className="sm:justify-between">
              <Link className="self-center text-sm font-medium text-[var(--accent-ink)] hover:underline" href={open.href}>Open the policy ›</Link>
              <span className="flex gap-2">
                {open.state === "short" && open.findingId ? (readOnly ? <PausedButton variant="outline">Accept as paid</PausedButton> : <Button variant="outline" disabled={busy} onClick={() => void acceptOne(open)}>Accept as paid</Button>) : null}
                {openAt! < shown.length - 1 ? <Button disabled={busy} onClick={() => setOpenAt(openAt! + 1)}>Next ›</Button> : <Button variant="outline" onClick={() => setOpenAt(null)}>Close</Button>}
              </span>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** The deposit (board 1·4): did the money land? A linked line unlinks behind a confirm; the closest line links behind one. */
export function PaymentDeposit({ p, readOnly }: { p: PaymentView; readOnly: boolean }) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const landed = p.deposits.reduce((n, d) => n + d.appliedCents, 0);
  const near = p.nearest;
  const linkCents = near ? Math.min(near.amountCents, p.paidCents - landed) : 0;
  const late = near ? daysBetween(p.dueBy, near.postedOn) : 0;
  const unlink = async (d: PaymentView["deposits"][number]) => {
    if (readOnly) return;
    const ok = await confirmAction({ title: "Unlink this deposit?", description: `The ${money(d.appliedCents)} goes back to Deposits › To match, and ${p.carrierName} ${shortDay(p.statementDate)} waits for its money again.`, confirmLabel: "Unlink", cancelLabel: "Keep it" });
    if (!ok) return;
    try {
      await postBank({ op: "remove", match_id: d.matchId });
      notify.done("Unlinked", { action: { label: "Undo", onClick: () => void postBank({ op: "manual", transaction_id: d.transactionId, statement_id: p.id, amount_cents: d.appliedCents }).then(() => router.refresh(), failed) } });
      router.refresh();
    } catch (err) {
      failed(err);
    }
  };
  const link = async () => {
    if (!near) return;
    setBusy(true);
    try {
      const json = await postBank({ op: "manual", transaction_id: near.id, statement_id: p.id, amount_cents: linkCents });
      setLinking(false);
      notify.done("Linked", { detail: `${money(linkCents)} of ${near.descriptionRaw} to ${p.carrierName} ${shortDay(p.statementDate)}.`, action: json?.result ? { label: "Undo", onClick: () => void postBank({ op: "remove", match_id: String(json.result) }).then(() => router.refresh(), failed) } : undefined });
      router.refresh();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };
  const box = "flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-border bg-[var(--color-card)] p-4";
  const figure = "text-base font-semibold tabular-nums text-[var(--ink)]";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className={box}><span className="text-xs text-muted-foreground">Carrier said they paid</span><span className={figure}>{money(p.paidCents)}</span><span className="text-xs text-muted-foreground">{readableDay(p.statementDate)} · due in the bank by {shortDay(p.dueBy)}</span></div>
        <span aria-label={p.money === "landed" ? "Linked" : "Not linked"} className={`grid size-10 place-items-center justify-self-center rounded-full border text-base font-semibold ${p.money === "landed" ? "border-[var(--success-ink)] text-[var(--success-ink)]" : p.money === "missing" ? "border-[var(--error-ink)] text-[var(--error-ink)]" : "border-border text-muted-foreground"}`}>{p.money === "landed" ? "✓" : p.money === "missing" ? "!" : "…"}</span>
        <div className={box}>
          <span className="text-xs text-muted-foreground">Bank shows</span>
          <span className={figure}>{p.deposits.length ? money(landed) : "Nothing"}</span>
          <span className="text-xs text-muted-foreground">
            {p.deposits.length ? p.deposits.map((d) => `${shortDay(d.postedOn)} · ${lagWords(p.statementDate, d.postedOn)}${d.confirmed ? "" : " · suggested"}`).join("; ")
              : p.money === "missing" ? `Looked from ${shortDay(p.statementDate)} to ${shortDay(p.dueBy)}${p.bankThrough ? ` · your file reaches ${shortDay(p.bankThrough)}` : ""}`
              : p.bankThrough && p.bankThrough < p.dueBy ? `Your bank file reaches ${shortDay(p.bankThrough)}; the deposit is due by ${shortDay(p.dueBy)}` : `Due by ${shortDay(p.dueBy)}`}
          </span>
        </div>
      </div>
      {p.deposits.length ? (
        <TableCard title="Linked deposits">
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th>On the bank statement</th><th>Date</th><th className="text-right">Amount</th><th>State</th></tr></thead>
            <tbody>
              {p.deposits.map((d) => (
                // One line per row (owner 2026-11-11): the account is the description's tooltip.
                <tr key={d.matchId} className="cursor-pointer" title={readOnly && d.confirmed ? "Paused while the account is read-only." : undefined} onClick={() => (d.confirmed ? void unlink(d) : router.push(`/app/bank?view=deposits&match=${d.transactionId}`))}>
                  <td className="whitespace-nowrap font-medium text-foreground" title={d.account}>{d.descriptionRaw}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(d.postedOn)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(d.appliedCents)}</td>
                  <td>{d.confirmed ? <StatusChip tone="good">Matched</StatusChip> : <StatusChip tone="info">Suggested · confirm it</StatusChip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}
      {p.money === "missing" && near ? (
        <TableCard title="Closest deposit">
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th>On the bank statement</th><th>Date</th><th className="text-right">Amount</th><th>Against the carrier</th></tr></thead>
            <tbody>
              <tr className="cursor-pointer" title={readOnly ? "Paused while the account is read-only." : undefined} onClick={() => { if (!readOnly) setLinking(true); }}>
                <td className="whitespace-nowrap font-medium text-foreground" title={near.account}>{near.descriptionRaw}</td>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(near.postedOn)}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{money(near.amountCents)}</td>
                <td className="whitespace-nowrap">{near.amountCents < p.paidCents ? `${money(p.paidCents - near.amountCents)} less` : near.amountCents > p.paidCents ? `${money(near.amountCents - p.paidCents)} more` : "The same amount"}{late > 0 ? ` · ${late} day${late === 1 ? "" : "s"} late` : ""}</td>
              </tr>
            </tbody>
          </table>
        </TableCard>
      ) : null}
      {!p.deposits.length && !(p.money === "missing" && near) ? <TableCard><EmptyState title="No deposit linked yet" hint={p.money === "waiting" ? `The deposit is due by ${readableDay(p.dueBy)}. Import the latest bank export to look again.` : "No bank line near this payment. Import the latest bank export, or match one by hand on Deposits."} /></TableCard> : null}
      {near ? (
        <ConfirmDialog
          open={linking}
          onOpenChange={setLinking}
          busy={busy}
          title={`Link ${money(linkCents)} to ${p.carrierName} ${shortDay(p.statementDate)}?`}
          description={`${near.amountCents < p.paidCents ? `It is ${money(p.paidCents - near.amountCents)} less than the carrier said` : near.amountCents > p.paidCents ? `It is ${money(near.amountCents - p.paidCents)} more than the carrier said` : "It is the amount the carrier said"}${late > 0 ? `, and ${late} day${late === 1 ? "" : "s"} past the window` : ""}.${p.paidCents - landed - linkCents > 0 ? ` The ${money(p.paidCents - landed - linkCents)} stays as missing money.` : ""}`}
          confirmLabel="Link it"
          destructive={false}
          onConfirm={() => void link()}
        />
      ) : null}
    </div>
  );
}

/** Letters (board 1·4): the dispute letters drafted from this payment; a letter opens where it is sent. */
export function PaymentLetters({ p }: { p: PaymentView }) {
  const router = useRouter();
  if (!p.letters.length) return <TableCard><EmptyState title="No letters yet" hint="Draft dispute letter writes one for the short policies. Nothing is sent from here." /></TableCard>;
  return (
    <TableCard footer={<div className="flex w-full flex-wrap justify-between gap-3 text-sm text-muted-foreground"><span>A letter opens on Commissions › Discrepancies › Letters, where it is sent.</span><span>{p.letters.length} letter{p.letters.length === 1 ? "" : "s"}</span></div>}>
      <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
        <thead><tr><th>For</th><th>Drafted</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {p.letters.map((l) => (
            <tr key={l.id} className="cursor-pointer" onClick={() => router.push("/app/discrepancies?view=letters")}>
              <td className="whitespace-nowrap font-medium text-foreground">{l.items} short {l.items === 1 ? "policy" : "policies"}</td>
              <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(l.createdAt)}</td>
              <td className="whitespace-nowrap text-right tabular-nums"><Link className="hover:underline" href="/app/discrepancies?view=letters" onClick={(e) => e.stopPropagation()}>{money(l.totalCents)}</Link></td>
              <td><StatusChip tone={l.status === "draft" ? "neutral" : "info"}>{LETTER_STATUS[l.status] ?? l.status}</StatusChip></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}
