"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { BankMatchDialog, postBank, type Stmt, type Txn } from "@/components/app/accounting/bank-match";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { ColumnMap } from "@/lib/accounting/bankCore";
import { MATCH_STATUS_LABELS, type MatchStatus } from "@/lib/accounting/bankLabels";
import { DEPOSIT_FILTERS, depositFilterOf, depositNextStep, readableDay, shortDay, type BankTab, type DepositFilter } from "@/lib/accounting/bankResultsCore";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.6 · what actually landed in the bank, matched to what the carriers say they paid. The system suggests; a
 * person confirms every match — a wrong automatic match would make a P&L look reconciled when it is not.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html § 1, direction B "Two questions"): the page's
 * tabs are Payments (bank-results.tsx) · Deposits · Accounts. Deposits is one list of bank lines whose state is a
 * chip (To match holds what were To match and Not explained); nothing is decided in a row — a row opens the Match
 * dialog (bank-match.tsx), where a suggestion is confirmed or declined, a line matched by hand or set aside. An
 * account row opens its dialog; Add an account is a dialog (it was an inline row). The title line's primary is
 * always the next thing to do on that tab; More holds Import a bank export and Suggest matches again.
 */
export type Account = { id: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap: ColumnMap | null };
export type Facts = { accountId: string; linesReach: string | null; deposits: number; lastImport: { at: string; rows: number } | null };
export type DepositsData = { accounts: Account[]; txns: Txn[]; statements: Stmt[] };

const money = (c: number) => formatCentsAsCurrency(c);
export const READ_ONLY = "Paused while the account is read-only.";
export const accountLabel = (a: Pick<Account, "nickname" | "lastFour"> | undefined) => (a ? `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}` : "Bank");
const TONE: Record<MatchStatus, StatusTone> = { unmatched: "warning", suggested: "info", matched: "good", partially_matched: "warning", ignored: "neutral" };
const STATUS_WORDS: Record<MatchStatus, string> = { ...MATCH_STATUS_LABELS, ignored: "Not carrier money" };
const has = (text: string | null | undefined, needle: string) => (text ?? "").toLowerCase().includes(needle);

/** A title-line button that is off while the account is read-only, saying why on hover (a disabled button shows no title). */
export function PausedButton({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "outline" }) {
  return <span className={buttonVariants({ variant, className: "pointer-events-auto cursor-not-allowed opacity-50" })} title={READ_ONLY} aria-disabled="true">{children}</span>;
}

/** The import itself: account, file, the column mapping, then the result. In the pop-up, opened from More or from a dropped bank file. */
export function BankImportForm({ accounts, initialFile = null, onClose, onDone }: { accounts: Account[]; initialFile?: File | null; onClose?: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(initialFile);
  const [preview, setPreview] = useState<{ headers: string[]; map: ColumnMap | null; remembered: boolean; problem: string | null } | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [mode, setMode] = useState<"single" | "split">("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rows: number; added: number; duplicates: number; skipped: { line: number; reason: string }[]; suggested: number } | null>(null);
  const send = async (previewOnly: boolean) => {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("account_id", accountId);
    if (previewOnly) form.set("preview", "1");
    else form.set("map", JSON.stringify(mode === "single" ? { ...map, credit: null, debit: null } : { ...map, amount: null }));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/accounting/bank/import", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "The file could not be read");
      if (previewOnly) { setPreview(json); setMap(json.map ?? { date: "", description: "", amount: "" }); setMode(json.map?.credit && json.map?.debit ? "split" : "single"); }
      else { setResult(json); notify.done(`Imported ${json.added} new line${json.added === 1 ? "" : "s"}`); onDone(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read");
    } finally {
      setBusy(false);
    }
  };
  const col = (key: keyof ColumnMap, label: string, optional = false) => (
    <Field label={label} htmlFor={`bank-col-${key}`}>
      <select id={`bank-col-${key}`} className={control} value={(map?.[key] as string | null | undefined) ?? ""} onChange={(e) => setMap((m) => ({ ...(m ?? { date: "", description: "" }), [key]: e.target.value || null }))}>
        <option value="">{optional ? "None" : "Choose…"}</option>
        {preview?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  );
  if (result) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="m-0"><strong>{result.added} new</strong>, {result.duplicates} already here, of {result.rows} lines read. {result.suggested} deposit{result.suggested === 1 ? " now has" : "s now have"} a suggested match to confirm.</p>
        {result.skipped.length ? <p className="m-0 text-[var(--error-ink)]">{result.skipped.length} line{result.skipped.length === 1 ? "" : "s"} could not be read: {result.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join(", ")}{result.skipped.length > 5 ? "…" : ""}.</p> : null}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => { setResult(null); setFile(null); setPreview(null); }}>Import another file</Button>
          <span className="flex gap-2">
            {onClose ? <Button variant={result.suggested ? "outline" : "default"} onClick={onClose}>Done</Button> : null}
            {result.suggested ? <Button asChild><Link href="/app/bank?view=deposits&step=1" onClick={onClose}>Match {result.suggested} one by one</Link></Button> : null}
          </span>
        </DialogFooter>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-xs text-muted-foreground">{preview ? "Step 2 of 3 · the columns" : "Step 1 of 3 · the file"}</p>
      {preview ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {col("date", "Date")}
          {col("description", "Description")}
          <Field label="Amounts are" htmlFor="bank-col-mode" hint={preview.remembered ? "This account's saved mapping." : "A first guess from the headers: check it. It is remembered for this account."}>
            <select id="bank-col-mode" className={control} value={mode} onChange={(e) => setMode(e.target.value as "single" | "split")}><option value="single">One signed column</option><option value="split">Money in and money out columns</option></select>
          </Field>
          {mode === "single" ? col("amount", "Amount") : <>{col("credit", "Money in")}{col("debit", "Money out")}</>}
          {col("reference", "Reference", true)}
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={!!map?.invert} onChange={(e) => setMap((m) => (m ? { ...m, invert: e.target.checked } : m))} />Deposits show as negative in this export</label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account" htmlFor="bank-import-account"><select id="bank-import-account" className={control} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></Field>
          <Field label="File" htmlFor="bank-import-file" hint={file ? file.name : undefined}><input id="bank-import-file" type="file" accept=".csv,text/csv" className="mt-1.5 block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></Field>
        </div>
      )}
      {error ? <p className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : null}
      <DialogFooter className="sm:justify-between">
        {preview ? <Button type="button" variant="ghost" onClick={() => setPreview(null)}>‹ Back</Button> : <span />}
        <span className="flex gap-2">
          {onClose ? <Button type="button" variant="outline" onClick={onClose}>Cancel</Button> : null}
          {preview ? <Button disabled={busy} onClick={() => void send(false)}>{busy ? "Importing…" : "Import"}</Button> : <Button disabled={busy || !file || !accountId} onClick={() => void send(true)}>{busy ? "Reading…" : "Read the columns"}</Button>}
        </span>
      </DialogFooter>
    </div>
  );
}

export function ImportDialog({ accounts, initialFile = null, onClose, onDone }: { accounts: Account[]; initialFile?: File | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size={"lg"}>
        <DialogHeader><DialogTitle>Import a bank export</DialogTitle><DialogDescription>A CSV from your bank, any date range: lines already here are skipped.</DialogDescription></DialogHeader>
        <BankImportForm accounts={accounts} initialFile={initialFile} onClose={onClose} onDone={onDone} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The title line's buttons, by tab (board 1·B): Payments has Check a payment (outline), More, and Review N short
 * payments (the worst one's page, hidden at 0); Deposits has More and Match N one by one; Accounts has More and
 * Add an account. Read-only: every button is off, saying why on hover.
 */
export function BankTitleActions({ tab, accounts, readOnly, review, toMatch }: { tab: BankTab; accounts: Account[]; readOnly: boolean; review: { count: number; href: string } | null; toMatch: number }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const suggest = async () => {
    setBusy(true);
    try {
      const json = await postBank({ op: "suggest" });
      notify.done("Suggestions refreshed", { detail: `${Number(json?.result ?? 0)} deposit${Number(json?.result ?? 0) === 1 ? "" : "s"} with a match to confirm.` });
      router.refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save", { detail: "Try again; nothing changed." });
    } finally {
      setBusy(false);
    }
  };
  const more = (
    <MoreMenu items={[
      { label: "Import a bank export", onSelect: () => setImporting(true), disabled: readOnly || accounts.length === 0 },
      { label: "Suggest matches again", onSelect: () => void suggest(), disabled: readOnly || busy || accounts.length === 0 },
    ]} />
  );
  const primary = tab === "payments"
    ? (review && review.count > 0 ? <Button asChild><Link href={review.href}>Review {review.count} short payment{review.count === 1 ? "" : "s"}</Link></Button> : null)
    : tab === "deposits"
      ? (toMatch > 0 ? (readOnly ? <PausedButton>Match {toMatch} one by one</PausedButton> : <Button asChild><Link href="/app/bank?view=deposits&step=1" scroll={false}>Match {toMatch} one by one</Link></Button>) : null)
      : (readOnly ? <PausedButton>Add an account</PausedButton> : <Button asChild><Link href="/app/bank?view=accounts&add=1" scroll={false}>Add an account</Link></Button>);
  return (
    <>
      {tab === "payments" ? (readOnly ? <PausedButton variant="outline">Check a payment</PausedButton> : <Button asChild variant="outline"><Link href="/app/bank/check">Check a payment</Link></Button>) : null}
      <span title={readOnly ? READ_ONLY : undefined}>{more}</span>
      {primary}
      {importing ? <ImportDialog accounts={accounts} onClose={() => setImporting(false)} onDone={() => router.refresh()} /> : null}
    </>
  );
}

function NoAccount({ readOnly }: { readOnly: boolean }) {
  return <EmptyState title="No bank account yet" hint="Add the account commission is paid into, then import its CSV export." action={readOnly ? <PausedButton>Add an account</PausedButton> : <Button asChild><Link href="/app/bank?view=accounts&add=1" scroll={false}>Add an account</Link></Button>} />;
}

/** What explains a bank line, in the row's words (the decision is the dialog's). One line: the old sub-line is `sub`, the cell's tooltip. */
function explains(t: Txn): { text: string; sub?: string } {
  const pending = t.matches.filter((m) => !m.confirmed);
  const confirmed = t.matches.filter((m) => m.confirmed);
  if (t.status === "ignored") return { text: "Not carrier money", sub: t.ignoredReason ?? undefined };
  const first = pending[0] ?? confirmed[0];
  if (!first) return { text: "Nothing explains it" };
  const more = (pending.length || confirmed.length) > 1 ? ` + ${(pending.length || confirmed.length) - 1} more` : "";
  const applied = confirmed.reduce((s, m) => s + m.amountAppliedCents, 0);
  return {
    text: `${first.carrierName} · ${shortDay(first.statementDate)}${more}`,
    sub: [`${first.carrierName} · statement ${shortDay(first.statementDate)} · ${money(first.amountAppliedCents)}${more}`, pending.length ? (first.reason ?? "suggested") : t.status === "partially_matched" ? `${money(t.amountCents - applied)} not explained yet` : null].filter(Boolean).join(" · "),
  };
}

/** A Deposits row's Next step as a short verb (the sentence is its tooltip). */
function depositStep(status: Txn["status"], pending: number): string {
  if (pending > 0) return "Confirm";
  if (status === "matched" || status === "ignored") return "Open";
  return "Match";
}

/** Deposits (board 1·1): one list of bank lines, its state as chips; a row opens the Match dialog. */
export function DepositsBoard({ data, readOnly, show, account: accountParam, openId, stepping }: { data: DepositsData; readOnly: boolean; show?: string; account?: string; openId?: string; stepping?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<DepositFilter>(DEPOSIT_FILTERS.find((f) => f === show) ?? "to_match");
  const [account, setAccount] = useState(data.accounts.some((a) => a.id === accountParam) ? accountParam! : "all");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(460, 52);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  // The Match dialog: one line (a row, or ?match= from To do), or stepping through every line to match, oldest first.
  const [open, setOpen] = useState<{ ids: string[]; at: number; stepping: boolean } | null>(() => {
    if (stepping) {
      const ids = data.txns.filter((t) => depositFilterOf(t.status) === "to_match").sort((a, b) => a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id)).map((t) => t.id);
      return ids.length ? { ids, at: 0, stepping: true } : null;
    }
    return openId && data.txns.some((t) => t.id === openId) ? { ids: [openId], at: 0, stepping: false } : null;
  });
  const close = () => { setOpen(null); setParamsInPlace({ match: null, step: null }); };
  const byId = useMemo(() => new Map(data.txns.map((t) => [t.id, t])), [data.txns]);
  const accountOf = (id: string) => data.accounts.find((a) => a.id === id);
  const needle = q.trim().toLowerCase();
  const inAccount = data.txns.filter((t) => account === "all" || t.accountId === account);
  const counts = { all: inAccount.length, to_match: 0, matched: 0, ignored: 0 };
  for (const t of inAccount) counts[depositFilterOf(t.status)] += 1;
  const shown = inAccount
    .filter((t) => filter === "all" || depositFilterOf(t.status) === filter)
    .filter((t) => !needle || has(t.descriptionRaw, needle) || has(t.reference, needle) || t.matches.some((m) => has(m.carrierName, needle)) || money(t.amountCents).includes(needle));
  const paged = paginate(shown, page, pageSize);
  const pick = (f: DepositFilter) => { setFilter(f); setPage(1); setParamsInPlace({ show: f === "to_match" ? null : f }); };
  const current = open ? byId.get(open.ids[open.at]) : undefined;

  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {data.accounts.length > 1 ? (
              <select aria-label="Account" className={toolbarControl} value={account} onChange={(e) => { setAccount(e.target.value); setPage(1); setParamsInPlace({ account: e.target.value === "all" ? null : e.target.value }); }}>
                <option value="all">Every account</option>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </select>
            ) : null}
            <RefreshButton onClick={refresh} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search description or reference" />
            <Segmented label="Deposits" value={filter} onChange={pick} options={[
              { key: "all", label: "All", count: counts.all },
              { key: "to_match", label: "To match", count: counts.to_match || null, tone: "danger" },
              { key: "matched", label: "Matched", count: counts.matched || null },
              { key: "ignored", label: "Not carrier money", count: counts.ignored || null },
            ]} />
          </DataToolbar>
        }
        footer={shown.length > pageSize ? <Pager page={paged.current} total={shown.length} noun="deposits" pageSize={pageSize} onPage={setPage} /> : shown.length ? <span className="text-sm text-muted-foreground">{shown.length} deposit{shown.length === 1 ? "" : "s"} · newest first</span> : undefined}
      >
        {data.accounts.length === 0 ? <NoAccount readOnly={readOnly} />
          : shown.length === 0 && (needle || filter !== "to_match") ? <NoMatches noun="deposits" onClear={() => { setQ(""); pick("to_match"); }} />
          : shown.length === 0 ? <EmptyState title="Nothing to match" hint="Every deposit is matched to a carrier statement, or set aside with a reason. Import the latest bank export to bring in new deposits." />
          : (
            <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
              <thead><tr><th>On the bank statement</th><th>Date</th><th className="text-right">Amount</th><th>What explains it</th><th>Status</th><th>Next step</th></tr></thead>
              <tbody>
                {paged.rows.map((t) => {
                  const why = explains(t);
                  const pending = t.matches.filter((m) => !m.confirmed).length;
                  const next = depositNextStep({ status: t.status, pending });
                  // One line per row (owner 2026-11-11): the account and bank reference are the description's tooltip.
                  return (
                    <tr key={t.id} className="cursor-pointer" onClick={() => setOpen({ ids: [t.id], at: 0, stepping: false })}>
                      <td className="whitespace-nowrap font-medium text-foreground" title={[accountLabel(accountOf(t.accountId)), t.reference ? `ref ${t.reference}` : null].filter(Boolean).join(" · ")}>{t.descriptionRaw}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{readableDay(t.postedOn)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums"><button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); setOpen({ ids: [t.id], at: 0, stepping: false }); }}>{money(t.amountCents)}</button></td>
                      <td className="whitespace-nowrap" title={why.sub}>{why.text}</td>
                      <td><StatusChip tone={TONE[t.status]}>{STATUS_WORDS[t.status]}</StatusChip></td>
                      <td className="whitespace-nowrap" title={next ?? undefined}>{depositStep(t.status, pending)} ›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </TableCard>
      {open && current ? (
        <BankMatchDialog
          key={current.id}
          txn={current}
          account={accountLabel(accountOf(current.accountId))}
          statements={data.statements}
          readOnly={readOnly}
          step={open.stepping ? { at: open.at, total: open.ids.length } : null}
          onClose={close}
          onChanged={refresh}
          onNext={open.stepping && open.at < open.ids.length - 1 ? () => setOpen({ ...open, at: open.at + 1 }) : undefined}
        />
      ) : null}
    </>
  );
}

/** "Date “Posting Date” · Description “Description” · Amount “Amount”": the mapping in its three parts. */
function reads(map: ColumnMap | null): { k: string; v: string }[] {
  if (!map) return [];
  return [
    { k: "Date", v: map.date },
    { k: "Description", v: map.description },
    map.amount ? { k: "Amount", v: `${map.amount} · one signed column${map.invert ? ", deposits negative" : ""}` } : { k: "Amount", v: `in “${map.credit ?? "—"}”, out “${map.debit ?? "—"}”` },
  ];
}

const digits = /^\d{4}$/;

/** Add an account (board 1·7; it was an inline row): only a name and the last four, never the number. */
function AddAccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ nickname: "", bank: "", last: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastProblem = f.last && !digits.test(f.last) ? "Exactly four digits." : null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await postBank({ op: "save_account", nickname: f.nickname, bank_name: f.bank || null, last_four: f.last || null });
      notify.done("Account added", { detail: "Import its CSV export next, from More." });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add an account</DialogTitle><DialogDescription>The account commission is paid into. Only a name and the last four digits are kept.</DialogDescription></DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (f.nickname.trim() && !lastProblem) void submit(); }}>
          <Field label="Name" htmlFor="bank-name" error={error}><input id="bank-name" className={control} required maxLength={80} autoFocus value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="e.g. Operating account" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank" htmlFor="bank-bank"><input id="bank-bank" className={control} maxLength={120} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></Field>
            <Field label="Last four" htmlFor="bank-last" error={lastProblem}><input id="bank-last" className={control} inputMode="numeric" maxLength={4} value={f.last} onChange={(e) => setF({ ...f, last: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.nickname.trim() || !!lastProblem}>{busy ? "Adding…" : "Add account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** An account row's dialog (board 1·7): its facts, and its name to change. The mapping changes on the next import. */
function AccountDialog({ a, facts, readOnly, onClose, onSaved }: { a: Account; facts: Facts | undefined; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(a.nickname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await postBank({ op: "save_account", id: a.id, nickname: name, bank_name: a.bankName, last_four: a.lastFour });
      notify.done("Account renamed", {
        detail: `${a.nickname} is now ${name.trim()}.`,
        action: { label: "Undo", onClick: () => void postBank({ op: "save_account", id: a.id, nickname: a.nickname, bank_name: a.bankName, last_four: a.lastFour }).then(onSaved, () => notify.fail("That didn't save", { detail: "Try again; nothing changed." })) },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  const map = reads(a.columnMap);
  const depositsHref = `/app/bank?view=deposits&show=all&account=${a.id}`;
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{accountLabel(a)}</DialogTitle>
          <DialogDescription>{[a.bankName, facts?.linesReach ? `lines reach ${readableDay(facts.linesReach)}` : "no lines yet", facts ? `${facts.deposits} deposit${facts.deposits === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!readOnly && name.trim() && name.trim() !== a.nickname) void save(); }}>
          <Field label="Name" htmlFor="bank-rename" error={error}><input id="bank-rename" className={control} maxLength={80} required disabled={readOnly} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {map.length ? (
            <dl className="m-0 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {map.map((m) => <div key={m.k} className="contents"><dt className="text-muted-foreground">{m.k}</dt><dd className="m-0">{m.v}</dd></div>)}
            </dl>
          ) : <p className="m-0 text-sm text-muted-foreground">The columns are read on the first import.</p>}
          <p className="m-0 text-xs text-muted-foreground">The mapping is set on import; change it on the next import&apos;s columns step.</p>
          <DialogFooter className="sm:justify-between">
            <Link className="self-center text-sm font-medium text-[var(--accent-ink)] hover:underline" href={depositsHref} onClick={onClose}>Its {facts?.deposits ?? 0} deposits ›</Link>
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
              {readOnly ? null : <Button type="submit" disabled={busy || !name.trim() || name.trim() === a.nickname}>{busy ? "Saving…" : "Save"}</Button>}
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Accounts (board 1·2): an account a row with what it reads and how far it reaches; a row opens the account dialog. */
export function AccountsBoard({ accounts, facts, readOnly, adding }: { accounts: Account[]; facts: Facts[]; readOnly: boolean; adding: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(adding && !readOnly);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const factsOf = new Map(facts.map((f) => [f.accountId, f]));
  const needle = q.trim().toLowerCase();
  const shown = accounts.filter((a) => !needle || has(a.nickname, needle) || has(a.bankName, needle));
  const opened = accounts.find((a) => a.id === openId);
  return (
    <>
      <TableCard
        toolbar={<DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}><ToolbarSearch value={q} onChange={setQ} placeholder="Search accounts" /></DataToolbar>}
        footer={accounts.length ? <span className="text-sm text-muted-foreground">{accounts.length} account{accounts.length === 1 ? "" : "s"} · only a name and the last four digits are kept</span> : undefined}
      >
        {accounts.length === 0 ? <NoAccount readOnly={readOnly} />
          : shown.length === 0 ? <NoMatches noun="accounts" onClear={() => setQ("")} />
          : (
            <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
              <thead><tr><th>Account</th><th>Bank</th><th>Lines reach</th><th>Last import</th><th className="text-right">Deposits</th></tr></thead>
              <tbody>
                {shown.map((a) => {
                  const f = factsOf.get(a.id);
                  const href = `/app/bank?view=deposits&show=all&account=${a.id}`;
                  const map = reads(a.columnMap);
                  return (
                    // One line per row (owner 2026-11-11): the columns the import reads are the name's tooltip (and the account's dialog).
                    <tr key={a.id} className="cursor-pointer" onClick={() => setOpenId(a.id)}>
                      <td className="whitespace-nowrap font-medium text-foreground" title={`Reads ${map.length ? map.map((m) => `${m.k} “${m.v}”`).join(" · ") : "set on the first import"}`}>{accountLabel(a)}</td>
                      <td className="whitespace-nowrap">{a.bankName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap tabular-nums">{f?.linesReach ? <span className="text-muted-foreground">{readableDay(f.linesReach)}</span> : "No lines yet"}</td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={f?.lastImport ? `${f.lastImport.rows} lines` : undefined}>{f?.lastImport ? readableDay(f.lastImport.at) : "—"}</td>
                      <td className="whitespace-nowrap text-right tabular-nums"><Link className="hover:underline" href={href} onClick={(e) => e.stopPropagation()}>{f?.deposits ?? 0}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </TableCard>
      {add ? <AddAccountDialog onClose={() => { setAdd(false); setParamsInPlace({ add: null }); }} onSaved={refresh} /> : null}
      {opened ? <AccountDialog a={opened} facts={factsOf.get(opened.id)} readOnly={readOnly} onClose={() => setOpenId(null)} onSaved={refresh} /> : null}
    </>
  );
}
