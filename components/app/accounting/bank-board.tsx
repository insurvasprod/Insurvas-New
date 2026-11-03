"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";

import { Callout } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, control, inputControl } from "@/components/ui/field";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import type { ColumnMap } from "@/lib/accounting/bankCore";
import { MATCH_STATUS_LABELS, type MatchStatus } from "@/lib/accounting/bankLabels";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.6 · what actually landed in the bank, matched to what the carriers say they paid. The
 * system suggests; a person confirms every match — a wrong automatic match would make a P&L look
 * reconciled when it is not. Two findings sit beside the queue: deposits nothing explains, and
 * statements the bank never shows paid.
 *
 * Foundation pass (2026-11-03): the four views are the step's tabs on the title line (`?view=`, the page draws
 * them), the header holds Import (the one primary) and More; the toolbar is search and Refresh. Adding an
 * account is a row at the foot of Accounts, not a pop-up; the import stays a pop-up because it is an upload.
 */
type Account = { id: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap: ColumnMap | null };
type Match = { id: string; statementId: string; carrierName: string; statementDate: string; amountAppliedCents: number; confidence: string; confirmed: boolean; reason: string | null };
type Txn = { id: string; accountId: string; postedOn: string; amountCents: number; descriptionRaw: string; reference: string | null; status: MatchStatus; ignoredReason: string | null; matches: Match[] };
type Stmt = { id: string; carrierName: string; statementDate: string; paidCents: number; receivedCents: number };
type Findings = { unexplained: { id: string; postedOn: string; amountCents: number; appliedCents: number; descriptionRaw: string }[]; notReceived: { statementId: string; carrierName: string; statementDate: string; paidCents: number; receivedCents: number; lagDays: number; dueBy: string }[] };
export type BankData = { accounts: Account[]; queue: Txn[]; statements: Stmt[]; findings: Findings };
export type BankView = "queue" | "unexplained" | "not_received" | "accounts";

const money = (c: number) => formatCentsAsCurrency(c);
const TONE: Record<MatchStatus, StatusTone> = { unmatched: "warning", suggested: "info", matched: "good", partially_matched: "warning", ignored: "neutral" };
const has = (text: string | null | undefined, needle: string) => (text ?? "").toLowerCase().includes(needle);

async function post(body: unknown) {
  const res = await fetch("/api/app/accounting/bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

/** Add an account: a row at the foot of the Accounts view (only a name and the last four, never the number). */
function AddAccountRow({ onDone }: { onDone: (saved: boolean) => void }) {
  const [f, setF] = useState({ nickname: "", bank: "", last: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post({ op: "save_account", nickname: f.nickname, bank_name: f.bank || null, last_four: f.last || null });
      notify.done("Account added");
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid items-end gap-3 border-t border-border px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_120px_auto]">
      <Field label="Name" htmlFor="bank-name" error={error}><input id="bank-name" className={control} required maxLength={80} autoFocus value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="e.g. Operating account" /></Field>
      <Field label="Bank" htmlFor="bank-bank"><input id="bank-bank" className={control} maxLength={120} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></Field>
      <Field label="Last four" htmlFor="bank-last"><input id="bank-last" className={control} inputMode="numeric" maxLength={4} pattern="\d{4}" title="Exactly four digits" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value.replace(/\D/g, "") })} /></Field>
      <span className="flex gap-2"><Button type="button" variant="outline" onClick={() => onDone(false)}>Cancel</Button><Button type="submit" disabled={busy}>Add account</Button></span>
    </form>
  );
}

function ImportDialog({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
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
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <div className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Import a bank export</DialogTitle><DialogDescription>A CSV from your bank, any date range: lines already here are skipped.</DialogDescription></DialogHeader>
          {result ? (
            <div className="flex flex-col gap-3 text-sm">
              <p>{result.rows} lines read: <strong>{result.added} new</strong>, {result.duplicates} already here. {result.suggested} deposit{result.suggested === 1 ? "" : "s"} now have a suggested match to confirm.</p>
              {result.skipped.length ? <Callout tone="warning" title={`${result.skipped.length} line${result.skipped.length === 1 ? "" : "s"} could not be read:`}>{result.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join("; ")}{result.skipped.length > 5 ? "…" : ""}</Callout> : null}
              <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Account" htmlFor="bank-import-account"><select id="bank-import-account" className={control} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}{a.lastFour ? ` ••${a.lastFour}` : ""}</option>)}</select></Field>
                <Field label="File" htmlFor="bank-import-file"><input id="bank-import-file" type="file" accept=".csv,text/csv" className="mt-1.5 block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></Field>
              </div>
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
              ) : null}
              {error ? <Callout tone="error" title={error} /> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                {preview ? <Button disabled={busy} onClick={() => void send(false)}>{busy ? "Importing…" : "Import"}</Button> : <Button disabled={busy || !file || !accountId} onClick={() => void send(true)}>{busy ? "Reading…" : "Read the columns"}</Button>}
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The step's header button: Import a bank export (the one primary, an upload). More sits beside Refresh. */
export function BankActions({ accounts, readOnly }: { accounts: Account[]; readOnly: boolean }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  if (readOnly || accounts.length === 0) return null;
  return (
    <>
      <Button onClick={() => setImporting(true)}>Import a bank export</Button>
      {importing ? <ImportDialog accounts={accounts} onClose={() => setImporting(false)} onDone={() => router.refresh()} /> : null}
    </>
  );
}

export function BankBoard({ data, view, adding = false, readOnly }: { data: BankData; view: BankView; adding?: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const pageSize = useFittingPageSize(520, 45);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<{ txn: string; statement: string; amount: string } | null>(null);
  const [ignoring, setIgnoring] = useState<{ txn: string; reason: string } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  const act = async (key: string, body: unknown, done: string) => {
    setBusy(key);
    try {
      await post(body);
      notify.done(done);
      setManual(null);
      setIgnoring(null);
      refresh();
    } catch (err) {
      notify.fail(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(null);
    }
  };
  const account = (id: string) => data.accounts.find((a) => a.id === id);
  const needle = q.trim().toLowerCase();
  const queue = useMemo(() => data.queue.filter((t) => !needle || has(t.descriptionRaw, needle) || has(t.reference, needle) || has(data.accounts.find((a) => a.id === t.accountId)?.nickname, needle) || t.matches.some((m) => has(m.carrierName, needle))), [data, needle]);
  const unexplained = useMemo(() => data.findings.unexplained.filter((d) => !needle || has(d.descriptionRaw, needle)), [data, needle]);
  const notReceived = useMemo(() => data.findings.notReceived.filter((n) => !needle || has(n.carrierName, needle)), [data, needle]);
  const accounts = useMemo(() => data.accounts.filter((a) => !needle || has(a.nickname, needle) || has(a.bankName, needle)), [data, needle]);
  const queueShown = paginate(queue, page, pageSize);
  const unexplainedShown = paginate(unexplained, page, pageSize);
  const notReceivedShown = paginate(notReceived, page, pageSize);
  const total = view === "queue" ? queue.length : view === "unexplained" ? unexplained.length : view === "not_received" ? notReceived.length : 0;
  const current = view === "queue" ? queueShown.current : view === "unexplained" ? unexplainedShown.current : notReceivedShown.current;
  const toReview = data.queue.filter((t) => t.matches.some((m) => !m.confirmed));
  const unexplainedCents = data.findings.unexplained.reduce((s, d) => s + d.amountCents - d.appliedCents, 0);
  const missingCents = data.findings.notReceived.reduce((s, n) => s + n.paidCents - n.receivedCents, 0);
  const search = (v: string) => { setQ(v); setPage(1); };
  const filtered = needle && total === 0 && view !== "accounts";

  return (
    <>
      <StatStrip label="Bank matching">
        <StatTile label="Suggestions to confirm" value={String(toReview.length)} valueTone={toReview.length ? "warning" : undefined} footnote="deposits" href="/app/bank" />
        <StatTile label="Not explained" value={money(unexplainedCents)} footnote={`${data.findings.unexplained.length} deposit${data.findings.unexplained.length === 1 ? "" : "s"} nothing accounts for`} href="/app/bank?view=unexplained" />
        <StatTile label="Paid but not received" value={money(missingCents)} valueTone={missingCents ? "danger" : undefined} footnote={`${data.findings.notReceived.length} statement${data.findings.notReceived.length === 1 ? "" : "s"} past the carrier's lag`} href="/app/bank?view=not_received" />
      </StatStrip>
      <TableCard toolbar={
        <DataToolbar actions={<>
          {/* The owner, 2026-11-03: More right beside Refresh. */}
          {!readOnly ? <MoreMenu items={[
            { label: "Add an account", href: "/app/bank?view=accounts&add=1" },
            data.accounts.length > 0 && { label: "Suggest matches again", onSelect: () => void act("suggest", { op: "suggest" }, "Suggestions refreshed"), disabled: busy !== null },
          ]} /> : null}
          <RefreshButton onClick={refresh} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={q} onChange={search} placeholder={view === "not_received" ? "Search carrier" : view === "accounts" ? "Search accounts" : "Search description"} />
        </DataToolbar>
      } footer={data.accounts.length && total > pageSize ? <Pager page={current} total={total} noun={view === "not_received" ? "statements" : "deposits"} pageSize={pageSize} onPage={setPage} /> : undefined}>
        {data.accounts.length === 0 && !adding ? (
          <EmptyState title="No bank account yet" hint="Add the account commission is paid into, then import its CSV export." action={!readOnly ? <Button asChild><Link href="/app/bank?view=accounts&add=1">Add an account</Link></Button> : undefined} />
        ) : filtered ? (
          <NoMatches noun={view === "not_received" ? "statements" : "deposits"} onClear={() => search("")} />
        ) : view === "accounts" ? (
          <>
            {accounts.length ? (
              <table className="portal-lead-table w-full text-left text-sm">
                <thead><tr><th>Account</th><th>Bank</th><th>Column mapping</th></tr></thead>
                <tbody>{accounts.map((a) => <tr key={a.id}><td className="font-medium">{a.nickname}{a.lastFour ? ` ••${a.lastFour}` : ""}</td><td>{a.bankName ?? "—"}</td><td className="text-xs text-muted-foreground">{a.columnMap ? `Date “${a.columnMap.date}”, description “${a.columnMap.description}”, ${a.columnMap.amount ? `amount “${a.columnMap.amount}”` : `in “${a.columnMap.credit}” / out “${a.columnMap.debit}”`}${a.columnMap.invert ? ", deposits negative" : ""}` : "Set on the first import"}</td></tr>)}</tbody>
              </table>
            ) : needle ? <NoMatches noun="accounts" onClear={() => search("")} /> : null}
            {adding && !readOnly ? <AddAccountRow onDone={(saved) => { router.replace("/app/bank?view=accounts"); if (saved) refresh(); }} /> : null}
          </>
        ) : view === "not_received" ? (
          notReceived.length === 0 ? <EmptyState title="Nothing missing" hint="Every statement past its lag has a deposit — or no bank data covers it yet." /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th>Carrier</th><th>Statement</th><th className="text-right">Said it paid</th><th className="text-right">Received</th><th>Due by</th></tr></thead>
              <tbody>{notReceivedShown.rows.map((n) => <tr key={n.statementId}><td className="font-medium">{n.carrierName}</td><td>{n.statementDate}</td><td className="text-right tabular-nums">{money(n.paidCents)}</td><td className="text-right tabular-nums">{money(n.receivedCents)}</td><td>{n.dueBy} <span className="text-xs text-muted-foreground">({n.lagDays}-day lag)</span></td></tr>)}</tbody>
            </table>
          )
        ) : view === "unexplained" ? (
          unexplained.length === 0 ? <EmptyState title="Everything is explained" hint="Every deposit is matched to a carrier statement, or ignored with a reason." /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th className="w-[110px]">Date</th><th>On the bank statement</th><th className="w-[130px] text-right">Amount</th><th className="w-[130px] text-right">Explained</th></tr></thead>
              <tbody>{unexplainedShown.rows.map((d) => <tr key={d.id}><td>{d.postedOn}</td><td className="font-mono text-xs">{d.descriptionRaw}</td><td className="text-right tabular-nums">{money(d.amountCents)}</td><td className="text-right tabular-nums">{money(d.appliedCents)}</td></tr>)}</tbody>
            </table>
          )
        ) : queue.length === 0 ? (
          <EmptyState title="Nothing to match" hint="Import the latest bank export to bring in new deposits." />
        ) : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th className="w-[104px]">Date</th><th>On the bank statement</th><th className="w-[110px] text-right">Amount</th><th className="w-[300px]">Matches</th><th className="w-[130px]">Status</th></tr></thead>
            <tbody>
              {queueShown.rows.map((t) => {
                const pending = t.matches.filter((m) => !m.confirmed);
                return (
                  <tr key={t.id} className="align-top">
                    <td>{t.postedOn}</td>
                    <td><div className="font-mono text-xs">{t.descriptionRaw}</div><div className="text-xs text-muted-foreground">{[account(t.accountId)?.nickname, t.reference ? `ref ${t.reference}` : null].filter(Boolean).join(" · ")}</div></td>
                    <td className="text-right tabular-nums">{money(t.amountCents)}</td>
                    <td>
                      <div className="flex flex-col gap-1">
                        {t.matches.map((m) => (
                          <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{m.carrierName} · {m.statementDate} · {money(m.amountAppliedCents)}{m.confirmed ? "" : <span className="text-muted-foreground"> · {m.reason}</span>}</span>
                            {!readOnly ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(m.id, { op: "remove", match_id: m.id }, m.confirmed ? "Match removed" : "Suggestion declined")}>{m.confirmed ? "Remove" : "Decline"}</Button> : null}
                          </div>
                        ))}
                        {!readOnly && pending.length ? <Button size="sm" className="self-start" disabled={busy !== null} onClick={() => void act(t.id, { op: "confirm", match_ids: pending.map((m) => m.id) }, "Confirmed")}>Confirm {pending.length === 1 ? "match" : `${pending.length} matches`}</Button> : null}
                        {/* Decided in place, under the row (the Book of business pattern), never a side panel. */}
                        {!readOnly && manual?.txn === t.id ? (
                          <div className="flex flex-wrap gap-1">
                            <select aria-label="Statement" className={`${inputControl} h-8 w-auto`} value={manual.statement} onChange={(e) => setManual({ ...manual, statement: e.target.value })}><option value="">Statement…</option>{data.statements.map((s) => <option key={s.id} value={s.id}>{s.carrierName} {s.statementDate} — {money(s.paidCents - s.receivedCents)} open</option>)}</select>
                            <input aria-label="Amount" className={`${inputControl} h-8 w-24`} inputMode="decimal" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
                            <Button size="sm" disabled={!manual.statement || parseDollarsToCents(manual.amount) === null} onClick={() => void act(t.id, { op: "manual", transaction_id: t.id, statement_id: manual.statement, amount_cents: parseDollarsToCents(manual.amount) }, "Matched")}>Match</Button>
                            <Button size="sm" variant="ghost" onClick={() => setManual(null)}>Cancel</Button>
                          </div>
                        ) : null}
                        {!readOnly && ignoring?.txn === t.id ? (
                          <div className="flex gap-1"><input aria-label="Why" className={`${inputControl} h-8 flex-1`} placeholder="Why it isn't carrier money" value={ignoring.reason} onChange={(e) => setIgnoring({ ...ignoring, reason: e.target.value })} /><Button size="sm" disabled={!ignoring.reason.trim()} onClick={() => void act(t.id, { op: "ignore", transaction_id: t.id, reason: ignoring.reason }, "Ignored")}>Ignore</Button><Button size="sm" variant="ghost" onClick={() => setIgnoring(null)}>Cancel</Button></div>
                        ) : null}
                        {!readOnly && manual?.txn !== t.id && ignoring?.txn !== t.id ? (
                          <span className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setManual({ txn: t.id, statement: "", amount: formatCentsAsCurrency(t.amountCents - t.matches.filter((m) => m.confirmed).reduce((s, m) => s + m.amountAppliedCents, 0)).replace(/[$,]/g, "") })}>Match by hand</Button>
                            <Button size="sm" variant="ghost" onClick={() => setIgnoring({ txn: t.id, reason: "" })}>Not carrier money</Button>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td><StatusChip tone={TONE[t.status]}>{MATCH_STATUS_LABELS[t.status]}</StatusChip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
