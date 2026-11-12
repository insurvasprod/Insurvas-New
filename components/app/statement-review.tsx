"use client";

/**
 * Reviewing one carrier statement: the step that puts a person's name on every ledger entry.
 *
 * Each line is in one of five states:
 *
 *   proposed        the import found one policy with this number and carrier → Accept, Reject, or
 *                   match another policy by hand
 *   unmatched       no proposal (or it was rejected) → match by hand, or leave unmatched on purpose
 *   left unmatched  a person said it matches nothing (a totals row, a fee) → can still be matched
 *   accepted        posted to the ledger; who accepted it and when, and whether it was exact or by
 *                   hand. Final — a wrong acceptance is corrected by voiding the statement
 *   could not read  the row's error; never posts
 *
 * Voiding takes a reason and removes the statement's lines from the ledger without deleting anything. LA-4.3: a
 * proposal made by insured name says so, so it is read with care; "Re-match" proposes again for the unmatched lines
 * against the book as it is now; "Re-process" re-reads the stored original with new column choices (a new statement
 * replaces this one, and this one is voided and kept).
 *
 * Round 7 (owner pick 1·A, 2026-11-10; mockups-r7/commissions.html boards 1·1–1·4): the page's tabs (Waiting ·
 * Accepted · Set aside · The file) pick the lines; a row has no buttons, it opens the line's dialog (1·2), which
 * steps to the next waiting line after each decision. The title line's primary is the next undecided line, put
 * there through a StepSlot; ⋯ holds Original file · Re-process · Void statement. Policy numbers read without
 * Excel's text guard. Nothing is a box on the page: an outcome is a toast, a failure is said in the dialog.
 */

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarCheckbox, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FactTable } from "@/components/ui/fact-table";
import { Field, textareaControl } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { StepSlot } from "@/components/app/step-frame/step-slot";
import { StatementMappingFields } from "@/components/app/statement-import";
import { STATEMENT_TAB_HOLDS, cleanPolicyNumber, statementFileHref, type StatementTab } from "@/components/app/commissions/statements/list-order";
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

// Which lines each tab holds lives in list-order.ts (a plain module), so the server page can count them.
const TAB_HOLDS = STATEMENT_TAB_HOLDS;
const isWaiting = (line: StatementLineView) => TAB_HOLDS.waiting(line.review);

type Chip = "unmatched" | "proposed" | "chargeback";

/** The 560px dialog (board 1·2/1·3: "lg 560"); named, since the tall-control rule counts a literal lg size as a 40px control. */
const WIDE_DIALOG = "lg" as const;
const n = (value: number) => value.toLocaleString("en-US");
const ink = "text-[var(--accent-ink)] hover:underline";

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was changed.");
  return data;
}

/** A line's name in a dialog's title: "Row 1 · Alex Lake · $626.37". */
const lineTitle = (line: StatementLineView) => [`Row ${line.lineNumber}`, line.insuredName ?? cleanPolicyNumber(line.policyNumber), line.amountCents === null ? null : statementMoney(line.amountCents)].filter(Boolean).join(" · ");

/**
 * The one chip a line's row shows (owner 2026-11-11: one line per row, colour only in a chip). Who decided, when, the
 * proposed policy and why are in the line's dialog, which the whole row opens.
 */
function lineState(line: StatementLineView): { text: string; tone: StatusTone; title?: string } {
  if (line.review === "proposed") return line.match?.method === "name" ? { text: "Check the name", tone: "warning", title: "Proposed by insured name: check it" } : { text: "Proposed", tone: "warning" };
  if (line.review === "unmatched") return { text: "No match", tone: "warning" };
  if (line.review === "accepted") return { text: "Accepted", tone: "good" };
  if (line.review === "left_unmatched") return { text: "Left unmatched", tone: "neutral" };
  return { text: "Unreadable", tone: "danger", title: line.parseError ?? "Could not be read" };
}

/**
 * The statement's ⋯ on the title line (board 1·1): Original file · Re-process · Void statement. A voided or
 * read-only statement keeps Original file only. Each action opens its dialog; a failure is said in that dialog.
 */
export function StatementActions({ statementId, canWrite, voided = false, hasFile = false, reprocess }: {
  statementId: string;
  canWrite: boolean;
  voided?: boolean;
  /** The carrier's original is stored (LA-4.1). */
  hasFile?: boolean;
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
  const writes = canWrite && !voided;
  if (!hasFile && !writes) return null;

  async function voidIt() {
    setBusy(true); setError(null);
    try {
      await send(`/api/app/statements/${statementId}`, "PATCH", { action: "void", reason: voidReason });
      setVoidOpen(false); setVoidReason("");
      notify.done("Statement voided.", { detail: "Its lines no longer post; the statement and the reason are kept." });
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
      notify.done("Statement re-processed.", { detail: "The new statement replaces this one; this one is voided and kept." });
      if (data.id) router.push(`/app/statements/${data.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement was not re-processed.");
      setBusy(false);
    }
  }

  return (
    <>
      {/* Not modal: an item opens a dialog, which takes the focus from the menu (as MoreMenu does). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More for this statement" disabled={busy}><MoreHorizontal aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasFile && <DropdownMenuItem asChild><a href={statementFileHref(statementId, true)}>Original file</a></DropdownMenuItem>}
          {writes && reprocess && <DropdownMenuItem onSelect={() => { setError(null); setReprocessMapping(reprocess.mapping); setReprocessOpen(true); }}>Re-process</DropdownMenuItem>}
          {writes && <DropdownMenuItem variant="destructive" onSelect={() => { setError(null); setVoidOpen(true); }}>Void statement</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      {writes && reprocess && (
        <Dialog open={reprocessOpen} onOpenChange={(next) => { if (!busy) setReprocessOpen(next); }}>
          <DialogContent size={WIDE_DIALOG} className="max-h-[calc(100vh-4rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Re-process this statement</DialogTitle>
              <DialogDescription>
                The stored original is read again with these columns. A new statement replaces this one; this one is voided and kept. Accepted lines need accepting again.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 text-sm">
              <StatementMappingFields idPrefix="reprocess-map" headers={reprocess.headers} mapping={reprocessMapping} onChange={setReprocessMapping} />
              {reprocessProblem && <p className="text-xs font-medium text-[var(--warning-ink)]">{reprocessProblem}</p>}
              {error && <p role="alert" className="text-xs font-medium text-[var(--error-ink)]">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReprocessOpen(false)}>Keep it</Button>
              <Button type="button" disabled={busy || Boolean(reprocessProblem)} title={reprocessProblem ?? undefined} onClick={() => void reprocessIt()}>
                {busy ? "Re-reading…" : "Re-process statement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {writes && (
        <Dialog open={voidOpen} onOpenChange={(next) => { if (!busy) setVoidOpen(next); }}>
          <DialogContent size="md" role="alertdialog">
            <DialogHeader>
              <DialogTitle>Void this statement?</DialogTitle>
              <DialogDescription>
                Its accepted lines leave the commission ledger. The statement, every line, every match and your reason are kept. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <Field label="Reason" htmlFor="void-reason" error={error}>
              <textarea
                id="void-reason"
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Wrong period chosen, carrier re-issued the statement…"
                className={textareaControl}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setVoidOpen(false)}>Keep it</Button>
              <Button type="button" variant="destructive" disabled={busy || voidReason.trim().length < 3} title={voidReason.trim().length < 3 ? "Say why this statement is being voided" : undefined} onClick={() => void voidIt()}>
                {busy ? "Voiding…" : "Void statement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function StatementReview({
  statementId,
  lines,
  policies,
  carrier,
  tab,
  canWrite,
  voided,
  initialLineId = null,
  slotId,
}: {
  statementId: string;
  lines: StatementLineView[];
  policies: StatementPolicyRef[];
  carrier: StatementCarrierOption | null;
  /** The page's line tab (Waiting · Accepted · Set aside). */
  tab: Exclude<StatementTab, "file">;
  canWrite: boolean;
  voided: boolean;
  /** `?line=`: the line whose dialog opens with the page (a row on Lines to match). */
  initialLineId?: string | null;
  /** The title line's slot for the primary (the next undecided line). */
  slotId: string;
}) {
  const router = useRouter();
  const [chip, setChip] = useState<Chip | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialLineId && lines.some((line) => line.id === initialLineId) ? initialLineId : null);
  const [refreshing, startRefresh] = useTransition();
  const pageSize = useFittingPageSize(420, 49);
  const unmatchedCount = lines.filter((line) => line.review === "unmatched").length;
  // LA-4.3 option c: lines set aside on purpose join a re-match only when the person ticks the box.
  const leftCount = lines.filter((line) => line.review === "left_unmatched").length;
  const [includeLeft, setIncludeLeft] = useState(false);
  const rematchCount = unmatchedCount + (includeLeft ? leftCount : 0);

  const onTab = lines.filter((line) => TAB_HOLDS[tab](line.review));
  const needle = search.trim().toLowerCase();
  const searched = onTab.filter((line) => !needle || [cleanPolicyNumber(line.policyNumber), line.insuredName, line.match?.policy?.policyNumber, line.match?.policy?.insuredName].some((value) => value?.toLowerCase().includes(needle)));
  const chipHolds = (line: StatementLineView, key: Chip) => (key === "chargeback" ? line.kind === "chargeback" : line.review === key);
  const visible = chip ? searched.filter((line) => chipHolds(line, chip)) : searched;
  const { current, rows } = paginate(visible, page, pageSize);
  const proposed = lines.filter((line) => line.review === "proposed" && line.match?.status === "proposed");
  const queue = lines.filter(isWaiting);
  const firstUnmatched = lines.find((line) => line.review === "unmatched") ?? null;
  const openLine = openId ? lines.find((line) => line.id === openId) ?? null : null;
  const filtered = Boolean(chip) || Boolean(needle);
  const clear = () => { setChip(null); setSearch(""); setPage(1); };
  const chips: Array<{ key: Chip; label: string }> = [
    ...(tab === "waiting" ? [{ key: "unmatched" as const, label: "No match yet" }, { key: "proposed" as const, label: "Proposed" }] : []),
    { key: "chargeback", label: "Chargebacks" },
  ];

  /** The waiting line after this one, in file order (wrapping round); null when no other waits. */
  const nextAfter = (id: string): StatementLineView | null => {
    const at = queue.findIndex((line) => line.id === id);
    const order = at < 0 ? queue : [...queue.slice(at + 1), ...queue.slice(0, at)];
    return order.find((line) => line.id !== id) ?? null;
  };

  async function decide(decisions: StatementLineDecision[], done: string, options: { from?: string; detail?: string } = {}): Promise<boolean> {
    setBusy(true);
    try {
      await send(`/api/app/statements/${statementId}/lines`, "POST", { decisions });
      const next = options.from ? nextAfter(options.from) : null;
      notify.done(done, { detail: options.detail ?? (next ? `Row ${next.lineNumber} is open next.` : undefined) });
      if (options.from) setOpenId(next?.id ?? null);
      router.refresh();
      return true;
    } catch (reason) {
      notify.fail("The decision was not recorded.", { detail: reason instanceof Error ? reason.message : "Nothing was changed." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function rematch() {
    setBusy(true);
    try {
      const data = (await send(`/api/app/statements/${statementId}/lines`, "POST", includeLeft ? { action: "rematch", include_left_unmatched: true } : { action: "rematch" })) as { proposed?: number };
      const found = data.proposed ?? 0;
      if (found) notify.done(`${n(found)} ${found === 1 ? "line has" : "lines have"} a proposed match now.`, { detail: `Check and accept ${found === 1 ? "it" : "them"}.` });
      else notify.warn(`Still no policy in your book matches ${includeLeft ? "these lines" : "the unmatched lines"}.`);
      setIncludeLeft(false);
      router.refresh();
    } catch (reason) {
      notify.fail("The lines were not re-matched.", { detail: reason instanceof Error ? reason.message : "Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const acceptAll = () => void decide(proposed.map((line) => ({ line_id: line.id, action: "accept" })), `${n(proposed.length)} proposed ${proposed.length === 1 ? "match" : "matches"} accepted and posted to the ledger.`);

  // The title line's primary: the next undecided line (board 1·1).
  const primary = canWrite && proposed.length > 0
    ? <Button type="button" disabled={busy} onClick={acceptAll}>Accept {n(proposed.length)} proposed</Button>
    : canWrite && firstUnmatched
      ? <Button type="button" disabled={busy} onClick={() => setOpenId(firstUnmatched.id)}>Match row {firstUnmatched.lineNumber}</Button>
      : null;

  const toolbar = (
    <DataToolbar
      actions={<>
        {canWrite && leftCount > 0 && (
          <ToolbarCheckbox
            checked={includeLeft}
            disabled={busy}
            onChange={setIncludeLeft}
            label={`Include ${n(leftCount)} left unmatched`}
            title="Also propose matches for the lines you set aside on purpose. A policy you already turned down for a line is never proposed for it again."
          />
        )}
        {canWrite && unmatchedCount + leftCount > 0 && (
          <Button type="button" variant="outline" disabled={busy || rematchCount === 0} title={rematchCount === 0 ? "Tick “Include left unmatched” to re-match the lines you set aside" : "Propose matches again against your book as it is now"} onClick={() => void rematch()}>
            Re-match {n(rematchCount)}
          </Button>
        )}
        {canWrite && tab === "waiting" && (
          <Button type="button" variant="outline" disabled={busy || proposed.length === 0} title={proposed.length === 0 ? "No line has a proposed match" : undefined} onClick={acceptAll}>
            Accept all {n(proposed.length)} proposed
          </Button>
        )}
        {filtered && <ClearFiltersButton onClick={clear} />}
        <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
      </>}
    >
      <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search policy or insured" />
      {chips.map((item) => (
        <ToggleChip key={item.key} selected={chip === item.key} count={n(searched.filter((line) => chipHolds(line, item.key)).length)} countTone={item.key === "unmatched" && searched.some((line) => line.review === "unmatched") ? "warning" : undefined} onClick={() => { setChip(chip === item.key ? null : item.key); setPage(1); }}>
          {item.label}
        </ToggleChip>
      ))}
    </DataToolbar>
  );

  const empty = {
    waiting: { title: "Nothing is waiting", hint: "Every line is accepted, left unmatched on purpose, or could not be read." },
    accepted: { title: "No line accepted yet", hint: voided ? "This statement is voided: none of its lines post." : "A line posts to the commission ledger once a person accepts its match." },
    aside: { title: "Nothing set aside", hint: "Lines left unmatched on purpose, and lines that could not be read, are kept here." },
  }[tab];

  return (
    <>
      {primary && <StepSlot id={slotId}>{primary}</StepSlot>}
      <TableCard
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>.overflow-x-auto]:flex-1"
        toolbar={toolbar}
        footer={<Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="lines" suffix="in file order" />}
      >
        {visible.length === 0 ? (
          filtered ? <NoMatches noun="lines" onClear={clear} /> : <EmptyState title={empty.title} hint={empty.hint} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[200px]">Policy number</th>
                <th>Insured</th>
                <th className="w-[130px]">Kind</th>
                <th className="w-[120px]">Date</th>
                <th className="w-[130px] text-right">Amount</th>
                <th className="w-[160px]">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => {
                const policy = line.match?.policy ?? null;
                const number = cleanPolicyNumber(line.policyNumber);
                const chip = lineState(line);
                return (
                  // A row opens its line's dialog (board 1·2); the policy link inside keeps its own way.
                  <tr key={line.id} tabIndex={0} aria-label={`Open ${lineTitle(line)}`} className={cn("m-row cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", openId === line.id && "bg-[var(--primary-soft)]")}
                    onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) setOpenId(line.id); }}
                    onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); setOpenId(line.id); } }}>
                    <td className="whitespace-nowrap font-medium text-foreground">
                      {policy && line.review === "accepted"
                        ? <Link href={`/app/policies/${policy.id}`} className="hover:underline" title={`Open policy ${policy.policyNumber}`}>{number ?? policy.policyNumber}</Link>
                        : number
                          ? <Link href={`/app/policies?q=${encodeURIComponent(number)}`} className="hover:underline" title={`Search your book for ${number}`}>{number}</Link>
                          : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="whitespace-nowrap">{line.insuredName ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap">{line.kind ? STATEMENT_KIND_LABELS[line.kind] : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{line.lineDate ? statementDay(line.lineDate) : "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{line.amountCents === null ? <span className="text-muted-foreground">—</span> : statementMoney(line.amountCents)}</td>
                    <td><StatusChip tone={chip.tone} title={chip.title}>{chip.text}</StatusChip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <LineDialog
        line={openLine}
        queue={queue}
        policies={policies}
        carrier={carrier}
        canWrite={canWrite}
        busy={busy}
        onClose={() => setOpenId(null)}
        onSkip={(id) => setOpenId(nextAfter(id)?.id ?? null)}
        onDecide={(line, decision, done) => decide([decision], done, { from: line.id })}
      />
    </>
  );
}

/**
 * The line's dialog (board 1·2). A line with no match: search the book, "Match and accept", "Leave unmatched" (it
 * asks first), Skip. A proposed match: Accept · Reject · Choose another. Accepted, set aside, unreadable, voided or
 * read-only: the line and its match as text, and only Close. "k of N" counts the waiting lines.
 */
function LineDialog({ line, queue, policies, carrier, canWrite, busy, onClose, onSkip, onDecide }: {
  line: StatementLineView | null;
  queue: StatementLineView[];
  policies: StatementPolicyRef[];
  carrier: StatementCarrierOption | null;
  canWrite: boolean;
  busy: boolean;
  onClose: () => void;
  onSkip: (id: string) => void;
  onDecide: (line: StatementLineView, decision: StatementLineDecision, done: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const lineId = line?.id ?? null;
  const number = cleanPolicyNumber(line?.policyNumber);
  // A new line starts afresh: its own number in the search, nothing picked.
  useEffect(() => { setQuery(number ?? ""); setPicked(null); setChoosing(false); }, [lineId]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const numberNeedle = normalisePolicyNumber(needle);
    return policies
      .filter((policy) => (numberNeedle && normalisePolicyNumber(policy.policyNumber).includes(numberNeedle)) || policy.insuredName.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [policies, query]);

  if (!line) return null;
  const at = queue.findIndex((item) => item.id === line.id);
  const searching = canWrite && (line.review === "unmatched" || line.review === "left_unmatched" || (line.review === "proposed" && choosing));
  const exact = matches.find((policy) => number && normalisePolicyNumber(policy.policyNumber) === normalisePolicyNumber(number));
  const chosen = matches.find((policy) => policy.id === (picked ?? exact?.id)) ?? null;
  const otherCarrier = chosen && carrier && !policyIsWithCarrier(chosen.carrier, carrier) ? chosen : null;
  const policy = line.match?.policy ?? null;
  const policyLink = policy ? <Link href={`/app/policies/${policy.id}`} className={ink}>{policy.policyNumber} · {policy.insuredName}</Link> : "A policy no longer in your book";
  const how = line.match?.method === "manual" ? "Matched by hand" : line.match?.method === "name" ? "By insured name" : "Number and carrier match";

  const facts: Array<[string, ReactNode]> = [
    ["On the statement", [number ?? "No policy number", line.insuredName].filter(Boolean).join(" · ")],
    ["Kind", line.kind ? STATEMENT_KIND_LABELS[line.kind] : null],
    ["Amount", line.amountCents === null ? null : statementMoney(line.amountCents)],
  ];
  if (line.review === "proposed" && !choosing) facts.unshift(["Proposed", policyLink], ["Why", <span key="why" className={line.match?.method === "name" ? "font-semibold text-[var(--warning-ink)]" : undefined}>{line.match?.method === "name" ? "By insured name: check it" : how}</span>]);
  if (line.review === "accepted") facts.unshift(["Matched to", policyLink], ["Accepted", `${line.match?.acceptedByName ? `by ${line.match.acceptedByName}` : "by a former member"}${line.match?.acceptedAt ? ` · ${statementDay(line.match.acceptedAt)}` : ""} · ${how.toLowerCase()}`]);
  if (line.review === "left_unmatched") facts.unshift(["Left unmatched", `${line.reviewedByName ? `by ${line.reviewedByName}` : "by a former member"}${line.reviewedAt ? ` · ${statementDay(line.reviewedAt)}` : ""}`]);
  if (line.review === "error") facts.unshift(["Could not read", <span key="err" className="text-[var(--error-ink)]">{line.parseError ?? "The row could not be read."}</span>]);
  if (line.review === "unmatched" && !canWrite) facts.unshift(["Match", "No match yet"]);
  if (line.review === "proposed" && choosing) facts.unshift(["Proposed", policyLink]);

  const leave = async () => {
    const ok = await confirmAction({ title: `Leave row ${line.lineNumber} unmatched?`, description: "It stays on the statement and does not post. Re-match with “Include left unmatched” can propose it again.", confirmLabel: "Leave unmatched", cancelLabel: "Back", destructive: false });
    if (ok) await onDecide(line, { line_id: line.id, action: "leave_unmatched" }, `Row ${line.lineNumber} left unmatched.`);
  };
  const matchIt = () => chosen && void onDecide(line, { line_id: line.id, action: "match", policy_id: chosen.id }, `Row ${line.lineNumber} matched to ${chosen.policyNumber} and posted to the ledger.`);

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent size={searching ? WIDE_DIALOG : "md"}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-x-3 pr-6">
            <span>{lineTitle(line)}</span>
            {at >= 0 && <span className="text-xs font-normal text-muted-foreground tabular-nums">{n(at + 1)} of {n(queue.length)}</span>}
          </DialogTitle>
          <DialogDescription>{[line.kind ? STATEMENT_KIND_LABELS[line.kind] : null, line.lineDate ? statementDay(line.lineDate) : null, number ? `policy ${number} on the statement` : null].filter(Boolean).join(" · ") || "A line on the statement"}</DialogDescription>
        </DialogHeader>

        {searching && (
          <div className="grid gap-1.5">
            <Label htmlFor={`pick-${line.id}`}>Policy number or insured name</Label>
            <Input id={`pick-${line.id}`} value={query} placeholder="Policy number or insured name" onChange={(event) => { setQuery(event.target.value); setPicked(null); }} autoFocus />
            {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">No policy in your book matches “{query.trim()}”.</p>}
            {matches.length > 0 && (
              <div role="listbox" aria-label="Policies in your book" className="grid gap-0.5 rounded-md border border-border p-1">
                {matches.map((candidate) => (
                  <button key={candidate.id} type="button" role="option" aria-selected={chosen?.id === candidate.id} onClick={() => setPicked(candidate.id)}
                    className={cn("rounded-sm px-2 py-1.5 text-left text-sm", chosen?.id === candidate.id ? "bg-[var(--primary-soft)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]")}>
                    {candidate.policyNumber} · {candidate.insuredName} <span className="font-normal text-muted-foreground">· {candidate.carrier}</span>
                  </button>
                ))}
              </div>
            )}
            {otherCarrier && <p className="text-xs font-medium text-[var(--error-ink)]">Recorded with {otherCarrier.carrier}, not {carrier?.name}. Check before matching.</p>}
          </div>
        )}

        <FactTable rows={facts} labelWidth={140} />

        <DialogFooter className="sm:justify-between">
          {line.review === "unmatched" && canWrite ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void leave()}>Leave unmatched</Button>
            : line.review === "proposed" && canWrite && !choosing ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setChoosing(true)}>Choose another</Button>
              : <span />}
          <span className="flex flex-wrap justify-end gap-2">
            {line.review === "proposed" && canWrite && choosing && <Button type="button" variant="outline" disabled={busy} onClick={() => setChoosing(false)}>Back</Button>}
            {at >= 0 && canWrite && queue.length > 1 && !(line.review === "proposed" && choosing) && <Button type="button" variant="outline" disabled={busy} onClick={() => onSkip(line.id)}>Skip</Button>}
            {line.review === "proposed" && canWrite && !choosing && <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void onDecide(line, { line_id: line.id, action: "reject" }, `Proposal for row ${line.lineNumber} rejected; the line waits unmatched.`)}>Reject</Button>
              <Button type="button" disabled={busy} onClick={() => void onDecide(line, { line_id: line.id, action: "accept" }, `Row ${line.lineNumber} accepted and posted to the ledger.`)}>Accept</Button>
            </>}
            {searching && <Button type="button" disabled={busy || !chosen} title={!chosen ? "Choose the policy this line pays on" : undefined} onClick={matchIt}>{busy ? "Recording…" : "Match and accept"}</Button>}
            {!searching && !(line.review === "proposed" && canWrite) && <Button type="button" variant="outline" onClick={onClose}>Close</Button>}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
