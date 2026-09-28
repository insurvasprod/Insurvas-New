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
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoMatches } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import {
  STATEMENT_KIND_LABELS,
  statementDay,
  statementMoney,
  type StatementCarrierOption,
  type StatementLineDecision,
  type StatementLineReview,
  type StatementLineView,
  type StatementPolicyRef,
} from "@/lib/ledger/statementConstants";
import { normalisePolicyNumber, policyIsWithCarrier } from "@/lib/ledger/statementMatch";

type Filter = "waiting" | "accepted" | "left_unmatched" | "error" | "all";
const FILTERS: Array<{ key: Filter; label: string; includes: (review: StatementLineReview) => boolean }> = [
  { key: "waiting", label: "Waiting for a person", includes: (review) => review === "proposed" || review === "unmatched" },
  { key: "accepted", label: "Accepted", includes: (review) => review === "accepted" },
  { key: "left_unmatched", label: "Left unmatched", includes: (review) => review === "left_unmatched" },
  { key: "error", label: "Could not read", includes: (review) => review === "error" },
  { key: "all", label: "All lines", includes: () => true },
];
const PAGE = 100;

const KIND_CHIP = {
  advance: "bg-[var(--info-surface)] text-[var(--info-ink)]",
  commission: "bg-[var(--success-surface)] text-[var(--success-ink)]",
  chargeback: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  adjustment: "bg-[var(--surface-alt)] text-[var(--body)]",
} as const;

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was changed.");
  return data;
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
  const waitingCount = lines.filter((line) => line.review === "proposed" || line.review === "unmatched").length;
  const [filter, setFilter] = useState<Filter>(waitingCount > 0 ? "waiting" : "all");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceOpen, setSourceOpen] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const active = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];
  const needle = search.trim().toLowerCase();
  const visible = lines.filter((line) =>
    active.includes(line.review) &&
    (!needle || [line.policyNumber, line.insuredName, line.match?.policy?.policyNumber, line.match?.policy?.insuredName].some((value) => value?.toLowerCase().includes(needle))),
  );
  const proposed = lines.filter((line) => line.review === "proposed" && line.match?.status === "proposed");

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

  async function voidIt() {
    setBusy(true); setError(null);
    try {
      await send(`/api/app/statements/${statementId}`, "PATCH", { action: "void", reason: voidReason });
      setVoidOpen(false); setVoidReason(""); setNotice("Statement voided. Its lines no longer post to the ledger; the statement and the reason are kept.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement was not voided.");
    } finally {
      setBusy(false);
    }
  }

  function openPicker(line: StatementLineView) {
    setPicking(picking === line.id ? null : line.id);
    setQuery(line.policyNumber ?? "");
  }

  const toolbar = (
    <DataToolbar
      actions={<>
        {canWrite && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setVoidOpen(true)}>
            Void statement
          </Button>
        )}
        {canWrite && proposed.length > 0 && (
          <Button type="button" disabled={busy} onClick={() => void decide(proposed.map((line) => ({ line_id: line.id, action: "accept" })), `${proposed.length.toLocaleString("en-US")} proposed ${proposed.length === 1 ? "match" : "matches"} accepted and posted to the ledger.`)}>
            Accept all {proposed.length.toLocaleString("en-US")} proposed
          </Button>
        )}
        <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
      </>}
    >
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setShown(PAGE); }} placeholder="Search policy or insured" />
      <select aria-label="Show lines" className={toolbarControl} value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setShown(PAGE); }}>
        {FILTERS.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label} ({lines.filter((line) => item.includes(line.review)).length.toLocaleString("en-US")})
          </option>
        ))}
      </select>
    </DataToolbar>
  );

  return (
    <div className="flex flex-col gap-4">
      {!canWrite && writeBlockedReason && !voided && <p role="status" className="rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">{writeBlockedReason}</p>}
      {notice && <p role="status" className="rounded-md bg-[var(--success-surface)] px-3 py-2 text-sm text-[var(--success-ink)]">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      <TableCard
        toolbar={toolbar}
        footer={<>
          <span>{visible.length.toLocaleString("en-US")} of {lines.length.toLocaleString("en-US")} lines</span>
          {visible.length > shown && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShown((current) => current + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more
            </Button>
          )}
        </>}
      >
        {visible.length === 0 ? (
          needle ? (
            <NoMatches noun="lines" onClear={() => setSearch("")} />
          ) : (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {filter === "waiting" ? "Nothing is waiting: every line is accepted, left unmatched on purpose, or could not be read." : "No line on this statement is in this state."}
            </p>
          )
        ) : (
          <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[56px] text-right">Row</th>
                <th>On the statement</th>
                <th className="w-[110px]">Kind</th>
                <th className="w-[110px]">Date</th>
                <th className="w-[120px] text-right">Amount</th>
                <th>Match</th>
                <th className="w-[230px] text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map((line) => {
                const policy = line.match?.policy ?? null;
                const otherCarrier = (candidate: StatementPolicyRef) => carrier && !policyIsWithCarrier(candidate.carrier, carrier);
                return [
                  <tr key={line.id} className="m-row align-top">
                    <td className="text-right tabular-nums text-muted-foreground">{line.lineNumber}</td>
                    <td>
                      <span className="block font-semibold text-foreground">{line.policyNumber ?? "No policy number"}</span>
                      {line.insuredName && <span className="block text-xs text-muted-foreground">{line.insuredName}</span>}
                      <button type="button" className="mt-0.5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline" aria-expanded={sourceOpen === line.id} onClick={() => setSourceOpen(sourceOpen === line.id ? null : line.id)}>
                        {sourceOpen === line.id ? "Hide source row" : "Source row"}
                      </button>
                    </td>
                    <td>{line.kind ? <span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${KIND_CHIP[line.kind]}`}>{STATEMENT_KIND_LABELS[line.kind]}</span> : "—"}</td>
                    <td className="tabular-nums">{line.lineDate ? statementDay(line.lineDate) : "—"}</td>
                    <td className={`text-right font-semibold tabular-nums ${line.amountCents !== null && line.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{line.amountCents === null ? "—" : statementMoney(line.amountCents)}</td>
                    <td>
                      {line.review === "error" && <span className="text-[var(--error-ink)]">{line.parseError}</span>}
                      {line.review === "proposed" && policy && (
                        <>
                          <span className="block font-semibold text-foreground">{policy.policyNumber}</span>
                          <span className="block text-xs text-muted-foreground">{policy.insuredName} · proposed: number and carrier match</span>
                        </>
                      )}
                      {line.review === "accepted" && (
                        <>
                          <span className="block font-semibold text-foreground">{policy ? `${policy.policyNumber} · ${policy.insuredName}` : "Matched policy"}</span>
                          <span className="block text-xs text-muted-foreground">
                            Accepted{line.match?.acceptedByName ? ` by ${line.match.acceptedByName}` : ""}{line.match?.acceptedAt ? ` · ${statementDay(line.match.acceptedAt)}` : ""} · {line.match?.method === "manual" ? "matched by hand" : "exact match"}
                          </span>
                        </>
                      )}
                      {line.review === "unmatched" && <span className="text-xs text-muted-foreground">No match yet{line.reviewedByName ? ` · proposal rejected by ${line.reviewedByName}` : ""}</span>}
                      {line.review === "left_unmatched" && <span className="text-xs text-muted-foreground">Left unmatched{line.reviewedByName ? ` by ${line.reviewedByName}` : ""}{line.reviewedAt ? ` · ${statementDay(line.reviewedAt)}` : ""}</span>}
                    </td>
                    <td className="text-right">
                      {canWrite && line.review === "proposed" && (
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button type="button" size="sm" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "accept" }], `Row ${line.lineNumber} accepted and posted to the ledger.`)}>Accept</Button>
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "reject" }], `Proposal for row ${line.lineNumber} rejected; the line waits unmatched.`)}>Reject</Button>
                          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => openPicker(line)}>Other…</Button>
                        </span>
                      )}
                      {canWrite && (line.review === "unmatched" || line.review === "left_unmatched") && (
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => openPicker(line)}>Match…</Button>
                          {line.review === "unmatched" && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "leave_unmatched" }], `Row ${line.lineNumber} left unmatched. It stays on the statement and does not post.`)}>Leave unmatched</Button>}
                        </span>
                      )}
                    </td>
                  </tr>,
                  sourceOpen === line.id && (
                    <tr key={`${line.id}:source`}>
                      <td />
                      <td colSpan={6}>
                        <dl className="grid gap-x-6 gap-y-1 rounded-md bg-[var(--surface-alt)] px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
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
                  picking === line.id && (
                    <tr key={`${line.id}:pick`}>
                      <td />
                      <td colSpan={6}>
                        <div className="grid gap-2 rounded-md border border-border bg-card px-3 py-3">
                          <Label htmlFor={`pick-${line.id}`}>Match row {line.lineNumber} to a policy in your book</Label>
                          <Input id={`pick-${line.id}`} value={query} placeholder="Policy number or insured name" onChange={(event) => setQuery(event.target.value)} autoFocus />
                          {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">No policy in your book matches “{query.trim()}”.</p>}
                          <ul className="grid gap-1">
                            {matches.map((candidate) => (
                              <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-alt)]">
                                <span className="min-w-0">
                                  <span className="font-semibold text-foreground">{candidate.policyNumber}</span>
                                  <span className="text-muted-foreground"> · {candidate.insuredName} · {candidate.carrier}</span>
                                  {otherCarrier(candidate) && <span className="block text-xs font-medium text-[var(--warning-ink)]">Recorded with {candidate.carrier}, not {carrier?.name}. Check before matching.</span>}
                                </span>
                                <Button type="button" size="sm" disabled={busy} onClick={() => void decide([{ line_id: line.id, action: "match", policy_id: candidate.id }], `Row ${line.lineNumber} matched to ${candidate.policyNumber} and posted to the ledger.`)}>
                                  Match and accept
                                </Button>
                              </li>
                            ))}
                          </ul>
                          <div className="flex justify-end">
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setPicking(null); setQuery(""); }}>Cancel</Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </TableCard>

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
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setVoidOpen(false)}>Keep it</Button>
            <Button type="button" variant="destructive" disabled={busy || voidReason.trim().length < 3} onClick={() => void voidIt()}>
              {busy ? "Voiding…" : "Void statement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
