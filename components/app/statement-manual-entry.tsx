"use client";

/**
 * LA-4.2 · a PDF carrier statement, and the grid its lines are typed into.
 *
 * The PDF is the carrier's file as it was stored. It opens through a 60-second link, and nothing
 * reads it but the person entering the lines: no AI, no extraction service. Each typed line is read
 * by the same rules as a file's (amount, kind, date) and matched the same way, so a typed statement
 * reviews exactly like an imported one. The lines are sent together, once; after that the statement
 * is reviewed like any other.
 *
 * A read-only account sees the PDF and why it cannot type, never the grid. Typed lines are kept as a
 * draft in this browser until they are recorded.
 *
 * Also exports StatementFileButton, the "Original file" action on a statement's header (LA-4.1).
 *
 * 2026-10-06 redesign: the PDF and the grid are two full-height columns that scroll on their own.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { usePersistedState } from "@/components/admin/use-persisted-state";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { STATEMENT_KIND_LABELS, STATEMENT_LINE_KINDS, type ManualStatementLine } from "@/lib/ledger/statementConstants";
import { parseAmountCents, parseStatementDate } from "@/lib/ledger/statementParse";
import { confirmAction } from "@/components/ui/confirm-dialog";

async function fileUrl(statementId: string, download: boolean): Promise<string> {
  const response = await fetch(`/api/app/statements/${statementId}/file${download ? "?download=1" : ""}`, { cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error ?? "The statement file could not be opened.");
  return data.url;
}

/** "Original file": downloads the carrier's file as it was imported. */
export function StatementFileButton({ statementId, label = "Original file" }: { statementId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try { window.location.assign(await fileUrl(statementId, true)); } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be opened."); } finally { setBusy(false); }
        }}
      >
        {busy ? "Opening…" : label}
      </Button>
      {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
    </span>
  );
}

const blank = (): ManualStatementLine => ({ policyNumber: "", insuredName: "", amount: "", kind: "", lineDate: "" });

/** The first problem with a typed line, the way the server will read it; null when it is complete. */
function lineProblem(line: ManualStatementLine): string | null {
  if (!line.policyNumber.trim() && !(line.insuredName ?? "").trim()) return "Add the policy number or the insured's name.";
  if (!line.amount.trim()) return "Add the amount.";
  if (parseAmountCents(line.amount) === null) return `“${line.amount.trim()}” is not an amount.`;
  if ((line.lineDate ?? "").trim() && !parseStatementDate(line.lineDate ?? "")) return `“${(line.lineDate ?? "").trim()}” is not a date.`;
  return null;
}

/**
 * Typed lines are kept in this browser until they are recorded, so leaving the page (or a lost
 * connection) does not throw away a long statement half typed. A convenience only: when storage is
 * unavailable the grid still works, it just starts empty next time.
 */
const draftKey = (statementId: string) => `insurvas.statement-lines-draft.${statementId}`;

/** A stored draft as lines; anything unexpected in it is dropped, never trusted. */
function draftLines(stored: unknown): ManualStatementLine[] {
  if (!Array.isArray(stored) || !stored.length) return [blank()];
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const kinds = new Set<string>(STATEMENT_LINE_KINDS);
  return stored.slice(0, 2000).map((entry: Record<string, unknown> | null) => ({
    policyNumber: text(entry?.policyNumber),
    insuredName: text(entry?.insuredName),
    amount: text(entry?.amount),
    kind: (kinds.has(text(entry?.kind)) ? text(entry?.kind) : "") as ManualStatementLine["kind"],
    lineDate: text(entry?.lineDate),
  }));
}

export function StatementManualEntry({ statementId, canWrite, writeBlockedReason }: { statementId: string; canWrite: boolean; writeBlockedReason: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  // The server renders the empty grid; the browser then shows any draft (useSyncExternalStore).
  const [draft, setDraft] = usePersistedState<unknown>(draftKey(statementId), null);
  const lines = useMemo(() => draftLines(draft), [draft]);
  const setLines = (next: (current: ManualStatementLine[]) => ManualStatementLine[]) => setDraft(next(lines));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fileUrl(statementId, false).then((next) => { if (live) setUrl(next); }).catch((reason) => { if (live) setViewerError(reason instanceof Error ? reason.message : "The PDF could not be opened."); });
    return () => { live = false; };
  }, [statementId]);

  const filled = lines.filter((line) => line.policyNumber.trim() || (line.insuredName ?? "").trim() || line.amount.trim());
  const problems = filled.map(lineProblem);
  const firstProblem = problems.findIndex(Boolean);
  const blocked = !filled.length ? "Type at least one line from the statement." : firstProblem >= 0 ? `Line ${lines.indexOf(filled[firstProblem]) + 1}: ${problems[firstProblem]}` : null;

  const patch = (index: number, change: Partial<ManualStatementLine>) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...change } : line)));

  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/app/statements/${statementId}/lines`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_manual_lines", lines: filled }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The lines were not recorded.");
      // Recorded: the draft has served its purpose.
      setDraft(null);
      try { window.localStorage.removeItem(draftKey(statementId)); } catch { /* storage blocked: nothing was kept */ }
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The lines were not recorded.");
      setBusy(false);
    }
  }

  const viewer = (
    <section aria-label="The carrier's PDF" className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-card xl:min-h-0">
      {url ? (
        <iframe title="Carrier statement PDF" src={url} className="h-[70vh] min-h-[420px] w-full flex-1 xl:h-full xl:min-h-0" />
      ) : viewerError ? (
        <p role="alert" className="px-6 py-10 text-center text-sm text-[var(--error-ink)]">{viewerError}</p>
      ) : (
        <SectionLoading rows={6} columns={1} label="Opening the PDF" />
      )}
    </section>
  );

  // Read-only (LA-4.2): the PDF stays readable, the entry grid is not offered at all.
  if (!canWrite) {
    return (
      <div className="flex flex-col gap-3 xl:h-[calc(100dvh-var(--top-bar-h)-210px)] xl:min-h-[520px]">
        {writeBlockedReason && <p role="status" className="rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{writeBlockedReason}</p>}
        {viewer}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:h-[calc(100dvh-var(--top-bar-h)-210px)] xl:min-h-[520px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {viewer}

      <div className="flex min-h-0 min-w-0 flex-col gap-3 xl:overflow-y-auto">
        {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
        <TableCard
          footer={<>
            <span>{filled.length.toLocaleString("en-US")} {filled.length === 1 ? "line" : "lines"} entered</span>
            <span className="inline-flex flex-wrap items-center gap-2">
              {filled.length > 0 && (
                <Button type="button" variant="ghost" disabled={busy} title="Empty the grid. Typed lines are kept on this computer until they are recorded." onClick={() => void confirmAction({ title: "Clear every line typed so far?", description: "The grid is emptied and the typed lines are gone from this computer.", confirmLabel: "Clear lines", cancelLabel: "Keep lines" }).then((ok) => { if (ok) setLines(() => [blank()]); })}>Clear</Button>
              )}
              <Button type="button" variant="outline" disabled={busy} onClick={() => setLines((current) => [...current, blank()])}><Plus aria-hidden="true" />Add line</Button>
              <Button type="button" disabled={busy || Boolean(blocked)} title={blocked ?? undefined} onClick={() => void submit()}>
                {busy ? "Recording…" : `Record ${filled.length.toLocaleString("en-US")} ${filled.length === 1 ? "line" : "lines"} for review`}
              </Button>
            </span>
          </>}
        >
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[44px] text-right">#</th>
                <th>Policy number</th>
                <th>Insured</th>
                <th className="w-[120px]">Amount</th>
                <th className="w-[130px]" title="Without a kind, a negative amount is a chargeback and a positive one commission.">Kind</th>
                <th className="w-[130px]" title="Without a date, the line posts on the last day of the period.">Date</th>
                <th className="w-[44px]"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const problem = (line.policyNumber.trim() || (line.insuredName ?? "").trim() || line.amount.trim()) ? lineProblem(line) : null;
                return (
                  <tr key={index} className="align-top">
                    <td className="pt-3 text-right tabular-nums text-muted-foreground">{index + 1}</td>
                    <td><Input aria-label={`Line ${index + 1} policy number`} value={line.policyNumber} onChange={(event) => patch(index, { policyNumber: event.target.value })} /></td>
                    <td><Input aria-label={`Line ${index + 1} insured`} value={line.insuredName ?? ""} onChange={(event) => patch(index, { insuredName: event.target.value })} /></td>
                    <td>
                      <Input aria-label={`Line ${index + 1} amount`} inputMode="decimal" placeholder="-412.50" className="tabular-nums" value={line.amount} aria-invalid={Boolean(problem && /amount/.test(problem))} onChange={(event) => patch(index, { amount: event.target.value })} />
                    </td>
                    <td>
                      <select aria-label={`Line ${index + 1} kind`} className={`${toolbarControl} w-full`} value={line.kind ?? ""} onChange={(event) => patch(index, { kind: event.target.value as ManualStatementLine["kind"] })}>
                        <option value="">From the sign</option>
                        {STATEMENT_LINE_KINDS.map((kind) => <option key={kind} value={kind}>{STATEMENT_KIND_LABELS[kind]}</option>)}
                      </select>
                    </td>
                    <td><Input aria-label={`Line ${index + 1} date`} type="date" value={line.lineDate ?? ""} onChange={(event) => patch(index, { lineDate: event.target.value })} /></td>
                    <td className="pt-1.5">
                      {lines.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((_, at) => at !== index))}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
        {blocked && filled.length > 0 && <p className="text-xs font-medium text-[var(--warning-ink)]">{blocked}</p>}
      </div>
    </div>
  );
}
