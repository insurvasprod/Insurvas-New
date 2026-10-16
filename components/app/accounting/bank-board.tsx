"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import type { ColumnMap } from "@/lib/accounting/bankCore";
import { MATCH_STATUS_LABELS, type MatchStatus } from "@/lib/accounting/bankLabels";
import { formatCentsAsCurrency, parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

/**
 * LA-7.6 · what actually landed in the bank, matched to what the carriers say they paid. The
 * system suggests; a person confirms every match — a wrong automatic match would make a P&L look
 * reconciled when it is not. Two findings sit beside the queue: deposits nothing explains, and
 * statements the bank never shows paid.
 */
type Account = { id: string; nickname: string; bankName: string | null; lastFour: string | null; columnMap: ColumnMap | null };
type Match = { id: string; statementId: string; carrierName: string; statementDate: string; amountAppliedCents: number; confidence: string; confirmed: boolean; reason: string | null };
type Txn = { id: string; accountId: string; postedOn: string; amountCents: number; descriptionRaw: string; status: MatchStatus; ignoredReason: string | null; matches: Match[] };
type Stmt = { id: string; carrierName: string; statementDate: string; paidCents: number; receivedCents: number };
type Findings = { unexplained: { id: string; postedOn: string; amountCents: number; appliedCents: number; descriptionRaw: string }[]; notReceived: { statementId: string; carrierName: string; statementDate: string; paidCents: number; receivedCents: number; lagDays: number; dueBy: string }[] };
export type BankData = { accounts: Account[]; queue: Txn[]; statements: Stmt[]; findings: Findings };

const money = (c: number) => formatCentsAsCurrency(c);
const TONE: Record<MatchStatus, StatusTone> = { unmatched: "warning", suggested: "info", matched: "good", partially_matched: "warning", ignored: "neutral" };

async function post(body: unknown) {
  const res = await fetch("/api/app/accounting/bank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

function AccountDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ nickname: "", bank: "", last: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post({ op: "save_account", nickname: f.nickname, bank_name: f.bank || null, last_four: f.last || null });
      notify.done("Account added");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save");
    }
  };
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Add a bank account</DialogTitle><DialogDescription>Only a name and the last four digits — never the full account number.</DialogDescription></DialogHeader>
          <label className="flex flex-col gap-1 text-sm">Name<input className={toolbarControl} required maxLength={80} value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="e.g. Operating account" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">Bank<input className={toolbarControl} maxLength={120} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-sm">Last four<input className={toolbarControl} inputMode="numeric" maxLength={4} value={f.last} onChange={(e) => setF({ ...f, last: e.target.value.replace(/\D/g, "") })} /></label>
          </div>
          {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Add account</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
    <label className="flex flex-col gap-1 text-sm">{label}
      <select className={toolbarControl} value={(map?.[key] as string | null | undefined) ?? ""} onChange={(e) => setMap((m) => ({ ...(m ?? { date: "", description: "" }), [key]: e.target.value || null }))}>
        <option value="">{optional ? "None" : "Choose…"}</option>
        {preview?.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <div className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>Import a bank export</DialogTitle><DialogDescription>Export a CSV from your bank — any date range: lines already imported are skipped.</DialogDescription></DialogHeader>
          {result ? (
            <div className="flex flex-col gap-2 text-sm">
              <p>{result.rows} lines read: <strong>{result.added} new</strong>, {result.duplicates} already here. {result.suggested} deposit{result.suggested === 1 ? "" : "s"} now have a suggested match to confirm.</p>
              {result.skipped.length ? <div className="rounded-md border border-[var(--warning)] bg-[var(--warning-surface)] p-2 text-[var(--warning-ink)]">{result.skipped.length} line{result.skipped.length === 1 ? "" : "s"} could not be read: {result.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join("; ")}{result.skipped.length > 5 ? "…" : ""}</div> : null}
              <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">Account<select className={toolbarControl} value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname}{a.lastFour ? ` ••${a.lastFour}` : ""}</option>)}</select></label>
                <label className="flex flex-col gap-1 text-sm">File<input type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></label>
              </div>
              {preview ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">{preview.remembered ? "This account's saved mapping." : "A first guess from the headers — check it; it is remembered for this account."}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {col("date", "Date")}
                    {col("description", "Description")}
                    <label className="flex flex-col gap-1 text-sm">Amounts are<select className={toolbarControl} value={mode} onChange={(e) => setMode(e.target.value as "single" | "split")}><option value="single">One signed column</option><option value="split">Money in and money out columns</option></select></label>
                    {mode === "single" ? col("amount", "Amount") : <>{col("credit", "Money in")}{col("debit", "Money out")}</>}
                    {col("reference", "Reference", true)}
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!map?.invert} onChange={(e) => setMap((m) => (m ? { ...m, invert: e.target.checked } : m))} />Deposits show as negative in this export</label>
                  </div>
                </div>
              ) : null}
              {error ? <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p> : null}
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

export function BankBoard({ data, readOnly }: { data: BankData; readOnly: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"queue" | "unexplained" | "not_received" | "accounts">("queue");
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
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
  const toReview = data.queue.filter((t) => t.matches.some((m) => !m.confirmed));
  const unexplainedCents = data.findings.unexplained.reduce((s, d) => s + d.amountCents - d.appliedCents, 0);
  const missingCents = data.findings.notReceived.reduce((s, n) => s + n.paidCents - n.receivedCents, 0);
  const account = (id: string) => data.accounts.find((a) => a.id === id);

  return (
    <>
      <StatStrip label="Bank matching">
        <StatTile label="Suggestions to confirm" value={String(toReview.length)} valueTone={toReview.length ? "warning" : undefined} footnote="deposits" />
        <StatTile label="Not explained" value={money(unexplainedCents)} footnote={`${data.findings.unexplained.length} deposit${data.findings.unexplained.length === 1 ? "" : "s"} nothing accounts for`} />
        <StatTile label="Paid but not received" value={money(missingCents)} valueTone={missingCents ? "danger" : undefined} footnote={`${data.findings.notReceived.length} statement${data.findings.notReceived.length === 1 ? "" : "s"} past the carrier's lag`} />
      </StatStrip>
      <ViewTabs label="Bank views" value={tab} onChange={setTab} tabs={[
        { key: "queue", label: "To match", count: data.queue.length },
        { key: "unexplained", label: "Not explained", count: data.findings.unexplained.length },
        { key: "not_received", label: "Not received", count: data.findings.notReceived.length, tone: "danger" },
        { key: "accounts", label: "Accounts", count: data.accounts.length },
      ]} />
      <TableCard toolbar={
        <DataToolbar actions={<>{!readOnly && data.accounts.length ? <Button variant="outline" disabled={busy !== null} onClick={() => void act("suggest", { op: "suggest" }, "Suggestions refreshed")}>Suggest again</Button> : null}{!readOnly ? <Button variant="outline" onClick={() => setAdding(true)}>Add account</Button> : null}{!readOnly && data.accounts.length ? <Button onClick={() => setImporting(true)}>Import a bank export</Button> : null}<RefreshButton onClick={refresh} refreshing={refreshing} /></>}>
          <span className="text-sm text-muted-foreground">Nothing is matched until a person confirms it.</span>
        </DataToolbar>
      }>
        {data.accounts.length === 0 ? (
          <EmptyState title="No bank account yet" hint="Add the account commission is paid into, then import its CSV export." action={!readOnly ? <Button onClick={() => setAdding(true)}>Add account</Button> : undefined} />
        ) : tab === "accounts" ? (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr><th>Account</th><th>Bank</th><th>Column mapping</th></tr></thead>
            <tbody>{data.accounts.map((a) => <tr key={a.id}><td className="font-medium">{a.nickname}{a.lastFour ? ` ••${a.lastFour}` : ""}</td><td>{a.bankName ?? "—"}</td><td className="text-xs text-muted-foreground">{a.columnMap ? `Date “${a.columnMap.date}”, description “${a.columnMap.description}”, ${a.columnMap.amount ? `amount “${a.columnMap.amount}”` : `in “${a.columnMap.credit}” / out “${a.columnMap.debit}”`}${a.columnMap.invert ? ", deposits negative" : ""}` : "Set on the first import"}</td></tr>)}</tbody>
          </table>
        ) : tab === "not_received" ? (
          data.findings.notReceived.length === 0 ? <EmptyState title="Nothing missing" hint="Every statement past its lag has a deposit — or no bank data covers it yet." /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th>Carrier</th><th>Statement</th><th className="text-right">Said it paid</th><th className="text-right">Received</th><th>Due by</th></tr></thead>
              <tbody>{data.findings.notReceived.map((n) => <tr key={n.statementId}><td className="font-medium">{n.carrierName}</td><td>{n.statementDate}</td><td className="text-right tabular-nums">{money(n.paidCents)}</td><td className="text-right tabular-nums">{money(n.receivedCents)}</td><td>{n.dueBy} <span className="text-xs text-muted-foreground">({n.lagDays}-day lag)</span></td></tr>)}</tbody>
            </table>
          )
        ) : tab === "unexplained" ? (
          data.findings.unexplained.length === 0 ? <EmptyState title="Everything is explained" hint="Every deposit is matched to a carrier statement, or ignored with a reason." /> : (
            <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
              <thead><tr><th className="w-[110px]">Date</th><th>On the bank statement</th><th className="w-[130px] text-right">Amount</th><th className="w-[130px] text-right">Explained</th></tr></thead>
              <tbody>{data.findings.unexplained.map((d) => <tr key={d.id}><td>{d.postedOn}</td><td className="font-mono text-xs">{d.descriptionRaw}</td><td className="text-right tabular-nums">{money(d.amountCents)}</td><td className="text-right tabular-nums">{money(d.appliedCents)}</td></tr>)}</tbody>
            </table>
          )
        ) : data.queue.length === 0 ? (
          <EmptyState title="Nothing to match" hint="Import the latest bank export to bring in new deposits." />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead><tr><th className="w-[110px]">Date</th><th>On the bank statement</th><th className="w-[120px] text-right">Amount</th><th className="w-[340px]">Matches</th><th className="w-[140px]">Status</th></tr></thead>
            <tbody>
              {data.queue.map((t) => {
                const pending = t.matches.filter((m) => !m.confirmed);
                return (
                  <tr key={t.id} className="align-top">
                    <td>{t.postedOn}</td>
                    <td><div className="font-mono text-xs">{t.descriptionRaw}</div><div className="text-xs text-muted-foreground">{account(t.accountId)?.nickname ?? ""}</div></td>
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
                        {!readOnly && manual?.txn === t.id ? (
                          <div className="flex flex-wrap gap-1">
                            <select aria-label="Statement" className={toolbarControl} value={manual.statement} onChange={(e) => setManual({ ...manual, statement: e.target.value })}><option value="">Statement…</option>{data.statements.map((s) => <option key={s.id} value={s.id}>{s.carrierName} {s.statementDate} — {money(s.paidCents - s.receivedCents)} open</option>)}</select>
                            <input aria-label="Amount" className={`${toolbarControl} w-24`} inputMode="decimal" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} />
                            <Button size="sm" disabled={!manual.statement || parseDollarsToCents(manual.amount) === null} onClick={() => void act(t.id, { op: "manual", transaction_id: t.id, statement_id: manual.statement, amount_cents: parseDollarsToCents(manual.amount) }, "Matched")}>Match</Button>
                          </div>
                        ) : null}
                        {!readOnly && ignoring?.txn === t.id ? (
                          <div className="flex gap-1"><input aria-label="Why" className={`${toolbarControl} flex-1`} placeholder="Why it isn't carrier money" value={ignoring.reason} onChange={(e) => setIgnoring({ ...ignoring, reason: e.target.value })} /><Button size="sm" disabled={!ignoring.reason.trim()} onClick={() => void act(t.id, { op: "ignore", transaction_id: t.id, reason: ignoring.reason }, "Ignored")}>Ignore</Button></div>
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
      {importing ? <ImportDialog accounts={data.accounts} onClose={() => setImporting(false)} onDone={refresh} /> : null}
      {adding ? <AccountDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} /> : null}
    </>
  );
}
