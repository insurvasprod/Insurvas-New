"use client";

/**
 * Reviewing one carrier statement: the step that puts a person's name on every ledger entry.
 *
 * Each line is in one of five states, and each state has its own actions:
 *
 *   proposed        the import found one policy with this number and carrier → Accept, Reject, or
 *                   match another policy by hand
 *   unmatched       no proposal (or it was rejected) → match by hand, or leave unmatched on purpose
 *   left unmatched  a person said it matches nothing (a totals row, a fee) → can still be matched
 *   accepted        posted to the ledger; who accepted it and when, and whether it was exact or by
 *                   hand. Final — a wrong acceptance is corrected by voiding the statement
 *   could not read  the row's error; never posts
 *
 * Every row keeps the carrier's cells verbatim, one click away. Voiding takes a reason and removes
 * the statement's lines from the ledger without deleting anything.
 *
 * LA-4.3: a proposal made by insured name (no policy number matched) says so, so it is read with
 * care. "Re-match" proposes again for the unmatched lines against the book as it is now. "Re-process"
 * re-reads the stored original with new column choices: a new statement replaces this one, and this
 * one is voided and kept.
 *
 * 2026-10-06 redesign: the statement's own actions (Void, Re-process) are StatementActions, in the
 * page header beside "Original file"; the line toolbar keeps the line actions. Matching by hand
 * opens in a dialog instead of a row pushed under the line. The list opens on every line (no filter
 * on by default), with the states as segmented chips carrying their counts, and a pager.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import { StatementMappingFields } from "@/components/app/statement-import";
import {
  STATEMENT_KIND_LABELS,
  statementDay,
  statementMoney,
  type StatementCarrierOption,
  type StatementLineDecision,
  type StatementLineReview,
  type StatementLineView,
  type StatementMapping,
  type StatementPolicyRef,
} from "@/lib/ledger/statementConstants";
import { statementMappingProblem } from "@/lib/ledger/statementParse";
import { normalisePolicyNumber, policyIsWithCarrier } from "@/lib/ledger/statementMatch";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Filter = "waiting" | "accepted" | "left_unmatched" | "error" | "all";
const FILTERS: Array<{ key: Filter; label: string; includes: (review: StatementLineReview) => boolean }> = [
  { key: "all", label: "All lines", includes: () => true },
  { key: "waiting", label: "Waiting for a person", includes: (review) => review === "proposed" || review === "unmatched" },
  { key: "accepted", label: "Accepted", includes: (review) => review === "accepted" },
  { key: "left_unmatched", label: "Left unmatched", includes: (review) => review === "left_unmatched" },
  { key: "error", label: "Could not read", includes: (review) => review === "error" },
];

const KIND_TONE: Record<keyof typeof STATEMENT_KIND_LABELS, StatusTone> = {
  advance: "info",
  commission: "good",
  chargeback: "danger",
  adjustment: "neutral",
};

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was changed.");
  return data;
}

/** What the Match column says about a line, and the full sentence for its tooltip. */
function matchNote(line: StatementLineView): { text: string; title?: string; warn?: boolean } {
  if (line.review === "proposed") {
    return line.match?.method === "name"
      ? { text: "By insured name: check it", title: "proposed by insured name; the policy number did not match, so check it", warn: true }
      : { text: "Number and carrier match", title: "proposed: number and carrier match" };
  }
  if (line.review === "accepted") {
    const text = `Accepted${line.match?.acceptedByName ? ` by ${line.match.acceptedByName}` : ""}${line.match?.acceptedAt ? ` · ${statementDay(line.match.acceptedAt)}` : ""} · ${line.match?.method === "manual" ? "matched by hand" : line.match?.method === "name" ? "matched by insured name" : "exact match"}${line.entrySource === "manual" ? " · typed from the PDF" : ""}`;
    return { text, title: text };
  }
  if (line.review === "unmatched") {
    const text = `No match yet${line.reviewedByName ? ` · proposal rejected by ${line.reviewedByName}` : ""}`;
    return { text, title: text };
  }
  if (line.review === "left_unmatched") {
    const text = `Left unmatched${line.reviewedByName ? ` by ${line.reviewedByName}` : ""}${line.reviewedAt ? ` · ${statementDay(line.reviewedAt)}` : ""}`;
    return { text, title: text };
  }
  return { text: "" };
}

/**
 * The statement's own actions, for the page header: Re-process (LA-4.3) and Void. Each opens its
 * dialog; a failure is shown in the dialog that caused it.
 */
export function StatementActions({ statementId, canWrite, reprocess }: {
  statementId: string;
  canWrite: boolean;
  /** LA-4.3: present when the statement can be re-read from its stored original. */
  reprocess?: { headers: string[]; mapping: StatementMapping } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessMapping, setReprocessMapping] = useState<StatementMapping>(reprocess?.mapping ?? {});
  const reprocessProblem = reprocess ? statementMappingProblem(reprocessMapping, reprocess.headers) : null;

  if (!canWrite) return null;

  async function voidIt() {
    setBusy(true); setError(null);
    try {
      await send(`/api/app/statements/${statementId}`, "PATCH", { action: "void", reason: voidReason });
      setVoidOpen(false); setVoidReason("");
      notify.done("Statement voided. Its lines no longer post to the ledger; the statement and the reason are kept.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement was not voided.");
    } finally {
      setBusy(false);
    }
  }

  async function reprocessIt() {
    setBusy(true); setError(null);
    try {
      const data = (await send(`/api/app/statements/${statementId}`, "PATCH", { action: "reprocess", mapping: reprocessMapping })) as { id?: string };
      setReprocessOpen(false);
      if (data.id) router.push(`/app/statements/${data.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement was not re-processed.");
      setBusy(false);
    }
  }

  return (
    <>
      {reprocess && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(null); setReprocessMapping(reprocess.mapping); setReprocessOpen(true); }}>
          Re-process
        </Button>
      )}
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(null); setVoidOpen(true); }}>
        Void statement
      </Button>

      {reprocess && (
        <Dialog open={reprocessOpen} onOpenChange={(next) => { if (!busy) setReprocessOpen(next); }}>
          <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-base">Re-process this statement</DialogTitle>
              <DialogDescription>
                The stored original is read again with these columns, and its lines are matched against your book as it is now. A new statement replaces this one; this one is voided and kept, with its decisions. Accepted lines on the new statement need accepting again.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-sm">
              <StatementMappingFields idPrefix="reprocess-map" headers={reprocess.headers} mapping={reprocessMapping} onChange={setReprocessMapping} />
              {reprocessProblem && <p className="text-xs font-medium text-[var(--warning-ink)]">{reprocessProblem}</p>}
            </div>
            {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReprocessOpen(false)}>Keep it</Button>
              <Button type="button" disabled={busy || Boolean(reprocessProblem)} title={reprocessProblem ?? undefined} onClick={() => void reprocessIt()}>
                {busy ? "Re-reading…" : "Re-process statement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={voidOpen} onOpenChange={(next) => { if (!busy) setVoidOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-base">Void this statement</DialogTitle>
            <DialogDescription>
              Its accepted lines leave the commission ledger. The statement, every line, every match and your reason are kept, and the same file can be imported again once this one is voided. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <textarea
              id="void-reason"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Wrong period chosen, carrier re-issued the statement…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setVoidOpen(false)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={busy || voidReason.trim().length < 3} onClick={() => void voidIt()}>
              {busy ? "Voiding…" : "Void statement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StatementReview({
  statementId,
  lines,
  policies,
  carrier,
  canWrite,
  writeBlockedReason,
  voided,
}: {
  statementId: string;
  lines: StatementLineView[];
  policies: StatementPolicyRef[];
  carrier: StatementCarrierOption | null;
  canWrite: boolean;
  writeBlockedReason: string | null;
  voided: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const pageSize = useFittingPageSize(470, 49);
  const unmatchedCount = lines.filter((line) => line.review === "unmatched").length;
  // LA-4.3 option c: lines set aside on purpose join a re-match only when the person ticks the box.
  const leftCount = lines.filter((line) => line.review === "left_unmatched").length;
  const [includeLeft, setIncludeLeft] = useState(false);
  const rematchCount = unmatchedCount + (includeLeft ? leftCount : 0);

  const active = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((line) =>
    active.includes(line.review) &&
    (!needle || [line.policyNumber, line.insuredName, line.match?.policy?.policyNumber, line.match?.policy?.insuredName].some((value) => value?.toLowerCase().includes(needle))),
  );
  const { current, rows } = paginate(visible, page, pageSize);
  const proposed = lines.filter((line) => line.review === "proposed" && line.match?.status === "proposed");
  const pickingLine = picking ? lines.find((line) => line.id === picking) ?? null : null;
  const filtered = filter !== "all" || Boolean(needle);
  const clear = () => { setFilter("all"); setSearch(""); setPage(1); };

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const numberNeedle = normalisePolicyNumber(needle);
    return policies
      .filter((policy) => (numberNeedle && normalisePolicyNumber(policy.policyNumber).includes(numberNeedle)) || policy.insuredName.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [policies, query]);

  async function decide(decisions: StatementLineDecision[], done: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await send(`/api/app/statements/${statementId}/lines`, "POST", { decisions });
      setNotice(done); setPicking(null); setQuery("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function rematch() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const data = (await send(`/api/app/statements/${statementId}/lines`, "POST", includeLeft ? { action: "rematch", include_left_unmatched: true } : { action: "rematch" })) as { proposed?: number };
      const proposed = data.proposed ?? 0;
      setNotice(proposed ? `${proposed.toLocaleString("en-US")} ${proposed === 1 ? "line has" : "lines have"} a proposed match now. Check and accept ${proposed === 1 ? "it" : "them"}.` : `Still no policy in your book matches ${includeLeft ? "these lines" : "the unmatched lines"}.`);
      setIncludeLeft(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The lines were not re-matched.");
    } finally {
      setBusy(false);
    }
  }

  function openPicker(line: StatementLineView) {
    setPicking(line.id);
    setQuery(line.policyNumber ?? "");
  }
  function closePicker() { setPicking(null); setQuery(""); }

  const toolbar = (
    <DataToolbar
      actions={<>
        {canWrite && leftCount > 0 && (
          <ToolbarCheckbox
            checked={includeLeft}
            disabled={busy}
            onChange={setIncludeLeft}
            label={`Include ${leftCount.toLocaleString("en-US")} left unmatched`}
            title="Also propose matches for the lines you set aside on purpose. A policy you already turned down for a line is never proposed for it again."
          />
        )}
        {canWrite && unmatchedCount + leftCount > 0 && (
          <Button type="button" variant="outline" disabled={busy || rematchCount === 0} title={rematchCount === 0 ? "Tick “Include left unmatched” to re-match the lines you set aside" : "Propose matches again against your book as it is now"} onClick={() => void rematch()}>
            Re-match {rematchCount.toLocaleString("en-US")}
          </Button>
        )}
        {canWrite && proposed.length > 0 && (
          <Button type="button" disabled={busy} onClick={() => void decide(proposed.map((line) => ({ line_id: line.id, action: "accept" })), `${proposed.length.toLocaleString("en-US")} proposed ${proposed.length === 1 ? "match" : "matches"} accepted and posted to the ledger.`)}>
            Accept all {proposed.length.toLocaleString("en-US")} proposed
          </Button>
        )}
        {filtered && <ClearFiltersButton onClick={clear} />}
        <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
      </>}
    >
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search policy or insured" />
      <div role="radiogroup" aria-label="Show lines" className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <ToggleChip key={item.key} role="radio" selected={filter === item.key} count={lines.filter((line) => item.includes(line.review)).length.toLocaleString("en-US")} onClick={() => { setFilter(item.key); setPage(1); }}>
            {item.label}
          </ToggleChip>
        ))}
      </div>
    </DataToolbar>
  );

  return (
    <div className="flex flex-col gap-4">
      {!canWrite && writeBlockedReason && !voided && <p role="status" className="rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{writeBlockedReason}</p>}
      {notice && <p role="status" className="rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-362px)] flex-col [&>.overflow-x-auto]:flex-1"
        toolbar={toolbar}
        footer={<Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="lines" suffix={`${lines.length.toLocaleString("en-US")} on the statement`} />}
      >
        {visible.length === 0 ? (
          needle ? (
            <NoMatches noun="lines" onClear={() => setSearch("")} />
          ) : (
            <EmptyState title={filter === "waiting" ? "Nothing is waiting" : "No line in this state"} hint={filter === "waiting" ? "Every line is accepted, left unmatched on purpose, or could not be read." : "No line on this statement is in this state."} />
          )
        ) : (
          <table className="portal-lead-table w-full min-w-[1180px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[56px] text-right">Row</th>
                <th className="w-[160px]">Policy number</th>
                <th>Insured</th>
                <th className="w-[120px]">Kind</th>
                <th className="w-[110px]">Date</th>
                <th className="w-[120px] text-right">Amount</th>
                <th>Match</th>
                <th>Note</th>
                <th className="w-[300px] text-right"><span className="sr-only">Decision</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => {
                const policy = line.match?.policy ?? null;
                const note = matchNote(line);
                const matchText = line.review === "error"
                  ? line.parseError ?? ""
                  : line.review === "proposed" && policy
                    ? `${policy.policyNumber} · ${policy.insuredName}`
                    : line.review === "accepted"
                      ? policy ? `${policy.policyNumber} · ${policy.insuredName}` : "Matched policy"
                      : "—";
                return [
                  <tr key={line.id} className="m-row">
                    <td className="text-right tabular-nums text-muted-foreground">{line.lineNumber}</td>
                    <td className="font-semibold text-foreground">{line.policyNumber ?? "No policy number"}</td>
                    <td className="max-w-[200px] truncate" title={line.insuredName ?? undefined}>{line.insuredName ?? "—"}</td>
                    <td>{line.kind ? <StatusChip tone={KIND_TONE[line.kind]} dot={false}>{STATEMENT_KIND_LABELS[line.kind]}</StatusChip> : "—"}</td>
                    <td className="tabular-nums">{line.lineDate ? statementDay(line.lineDate) : "—"}</td>
                    <td className={`text-right font-semibold tabular-nums ${line.amountCents !== null && line.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{line.amountCents === null ? "—" : statementMoney(line.amountCents)}</td>
                    <td className={cn("max-w-[240px] truncate", line.review === "error" ? "text-[var(--error-ink)]" : policy && (line.review === "proposed" || line.review === "accepted") ? "font-semibold text-foreground" : "text-muted-foreground")} title={matchText}>{matchText}</td>
                    <td className={cn("max-w-[260px] truncate", note.warn ? "font-medium text-[var(--warning-ink)]" : "text-muted-foreground")} title={note.title}>{note.text || "—"}</td>
                    <td className="text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {canWrite && line.review === "proposed" && <>
                          <Button type="button" size="sm" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "accept" }], `Row ${line.lineNumber} accepted and posted to the ledger.`)}>Accept</Button>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "reject" }], `Proposal for row ${line.lineNumber} rejected; the line waits unmatched.`)}>Reject</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => openPicker(line)}>Other…</Button>
                        </>}
                        {canWrite && (line.review === "unmatched" || line.review === "left_unmatched") && <>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => openPicker(line)}>Match…</Button>
                          {line.review === "unmatched" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "leave_unmatched" }], `Row ${line.lineNumber} left unmatched. It stays on the statement and does not post.`)}>Leave unmatched</Button>}
                        </>}
                        <Button type="button" size="sm" variant="ghost" aria-expanded={sourceOpen === line.id} onClick={() => setSourceOpen(sourceOpen === line.id ? null : line.id)}>
                          {sourceOpen === line.id ? "Hide source" : "Source row"}
                        </Button>
                      </span>
                    </td>
                  </tr>,
                  sourceOpen === line.id && (
                    <tr key={`${line.id}:source`}>
                      <td />
                      <td colSpan={8}>
                        <dl className="grid gap-x-6 gap-y-1 rounded-md bg-[var(--surface-alt)] px-3 py-2 text-xs whitespace-normal sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(line.raw).map(([header, value]) => (
                            <div key={header} className="flex min-w-0 gap-2">
                              <dt className="shrink-0 font-semibold text-muted-foreground">{header}</dt>
                              <dd className="min-w-0 break-words text-foreground">{value === "" ? "—" : value}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={Boolean(pickingLine)} onOpenChange={(next) => { if (!next && !busy) closePicker(); }}>
        <DialogContent className="sm:max-w-xl">
          {pickingLine && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Match row {pickingLine.lineNumber} to a policy in your book</DialogTitle>
                <DialogDescription>
                  {pickingLine.policyNumber ?? "No policy number"}{pickingLine.insuredName ? ` · ${pickingLine.insuredName}` : ""}{pickingLine.amountCents !== null ? ` · ${statementMoney(pickingLine.amountCents)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`pick-${pickingLine.id}`}>Policy number or insured name</Label>
                <Input id={`pick-${pickingLine.id}`} value={query} placeholder="Policy number or insured name" onChange={(event) => setQuery(event.target.value)} autoFocus />
                {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">No policy in your book matches “{query.trim()}”.</p>}
                <ul className="grid gap-1">
                  {matches.map((candidate) => {
                    const otherCarrier = carrier && !policyIsWithCarrier(candidate.carrier, carrier);
                    return (
                      <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-alt)]">
                        <span className="min-w-0">
                          <span className="font-semibold text-foreground">{candidate.policyNumber}</span>
                          <span className="text-muted-foreground"> · {candidate.insuredName} · {candidate.carrier}</span>
                          {otherCarrier && <span className="block text-xs font-medium text-[var(--warning-ink)]">Recorded with {candidate.carrier}, not {carrier?.name}. Check before matching.</span>}
                        </span>
                        <Button type="button" size="sm" disabled={busy} onClick={() => void decide([{ line_id: pickingLine.id, action: "match", policy_id: candidate.id }], `Row ${pickingLine.lineNumber} matched to ${candidate.policyNumber} and posted to the ledger.`)}>
                          Match and accept
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={closePicker}>Cancel</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
