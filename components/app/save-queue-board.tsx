"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { ACTION_TAKEN, BANDS, CLIENT_REASON_LABELS, CLIENT_REASONS, CONTACT_OUTCOME_LABELS, CONTACT_OUTCOMES, MISSING_LABELS, SIGNAL_LABELS, SNOOZE_DAYS, type ActionTaken, type Band, type ClientReason, type ContactOutcome, type Signal } from "@/lib/retention/constants";
import { SORT_LABELS, SORTS, type QueueSort } from "@/lib/retention/queue";
import { REQUEST_FOR_FIX, REQUEST_LABELS, STATUS_LABELS, type RequestType } from "@/lib/retention/servicing";
import { ServicingRequestDialog } from "@/components/app/servicing-request-dialog";
import { IncomeCapture } from "@/components/app/retention/income-capture";
import { coverageText } from "@/lib/retention/income";
import type { SaveCard, SaveQueue } from "@/lib/retention/queueStore";
import { notify } from "@/lib/notify";

const money = (cents: number | null) => {
  if (cents === null) return null;
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `$${Number(digits.slice(0, -2)).toLocaleString("en-US")}`;
};
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
/** LA-5.2's audit trail: what each known sign added, which sums to the score. */
const breakdownText = (card: SaveCard) =>
  ["A prediction from the chargeback radar, not something the carrier reported.", ...card.contributions.map((c) => `${SIGNAL_LABELS[c.signal]}: +${c.contribution}`), `Score ${card.score}`].join("\n");

const BAND_INK: Record<Band, string> = { critical: "text-[var(--error-ink)]", high: "text-[var(--warning-ink)]", medium: "text-[var(--info-ink)]", low: "text-muted-foreground" };
const ACTION_LABELS: Record<ActionTaken, string> = {
  none: "Nothing changed",
  move_draft_date: "Agreed to move the payment date",
  convert_to_draft: "Agreed to switch to bank payment",
  confirm_card_funded: "Confirmed the card will be funded",
  confirm_account: "Confirmed the account",
  review_coverage: "Reviewed the coverage",
  courtesy_call: "Courtesy check-in",
};
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";

/** What a card still needs before it can be worked well (owner 2026-11-02: "help the agent if there's things to fix"). */
type Need = "failed" | "phone" | "income";
const NEED_LABELS: Record<Need, string> = { failed: "Fix not in the file", phone: "No phone", income: "No income" };
const needsOf = (card: SaveCard): Need[] => [...(card.failedFix ? ["failed" as const] : []), ...(card.phone ? [] : ["phone" as const]), ...(card.incomeKnown ? [] : ["income" as const])];

/**
 * LA-5.3 (Notion sprint) · the save queue. A prediction, drawn as one: the risk sits in a dashed
 * outline and always says how many signals it rests on, so it can never be taken for Lapse risk's
 * observed facts. Phone on the row; the reason is the opening line; the first fix starts from the row.
 *
 * 2026-11-02 tidy (owner): one line per fact, the table fits its card, "Log call" is the row's button and
 * the rest (snooze, income, the other fix) is in its ⋯ menu; chips find the cards that still need something.
 */
export function SaveQueueBoard({ queue, sort, readOnly, canStartFix }: { queue: SaveQueue; sort: QueueSort; readOnly: boolean; canStartFix: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const [band, setBand] = useState("");
  const [carrier, setCarrier] = useState("");
  const [need, setNeed] = useState<Need | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [logging, setLogging] = useState<SaveCard | null>(null);
  const [holding, setHolding] = useState<SaveCard | null>(null);
  const [fixing, setFixing] = useState<{ card: SaveCard; type: RequestType } | null>(null);
  const [incomeFor, setIncomeFor] = useState<string | null>(null);

  const cards = queue.cards;
  const carriers = useMemo(() => [...new Map(cards.map((c) => [c.carrierId, c.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [cards]);
  const needCounts = useMemo(() => {
    const counts: Record<Need, number> = { failed: 0, phone: 0, income: 0 };
    for (const card of cards) for (const n of needsOf(card)) counts[n] += 1;
    return counts;
  }, [cards]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => cards.filter((c) => (!band || c.band === band) && (!carrier || c.carrierId === carrier) && (!need || needsOf(c).includes(need))
    && (!needle || [c.clientName, c.policyNumber, c.phone, c.carrierName].some((v) => v?.toLowerCase().includes(needle)))), [cards, band, carrier, need, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);
  const { stats } = queue;
  const filtered = Boolean(band || carrier || need || needle);
  const clear = () => { setBand(""); setCarrier(""); setNeed(""); setSearch(""); setPage(1); };
  const fixesOf = (card: SaveCard) => card.fixes.filter((f) => !(card.noBankAccount && f.action === "convert_to_draft"));
  // A column every card leaves empty says nothing (owner 2026-11-02 critique): drawn only once one card has it.
  const showWorth = cards.some((c) => c.atRiskCents !== null);
  const showDraft = cards.some((c) => c.nextDraftDays !== null);
  const cols = 4 + (showWorth ? 1 : 0) + (showDraft ? 1 : 0);
  const startable = (card: SaveCard, action: string): RequestType | null => {
    const type = (REQUEST_FOR_FIX as Record<string, RequestType | undefined>)[action];
    return type && canStartFix && !readOnly && !card.openRequests.some((r) => r.type === type) ? type : null;
  };

  return (
    <>
      {stats.scored > 0 && <StatStrip label="Save queue">
        <StatTile label="In the queue" value={queue.total.toLocaleString("en-US")} footnote={queue.total > cards.length ? `first ${cards.length} shown` : `of ${stats.scored.toLocaleString("en-US")} scored`} />
        <StatTile label="Critical" value={stats.critical.toLocaleString("en-US")} valueTone={stats.critical ? "danger" : undefined} footnote={`${stats.highOrAbove.toLocaleString("en-US")} high or critical`} />
        <StatTile label="Advance at risk" value={cards.length && stats.atRiskUnknown < cards.length ? money(stats.atRiskCents) : "—"} footnote={!cards.length ? "nothing in the queue" : stats.atRiskUnknown === cards.length ? "no advance on file yet" : stats.atRiskUnknown ? `${stats.atRiskUnknown} with no advance on file` : "unearned, in the queue"} />
        <StatTile label="Too little known" value={queue.lowConfidence.toLocaleString("en-US")} labelTitle="High or critical, but scored on under half the signals. They stay off the queue until more is known: income, the carrier's grace rule, a second carrier file, the draft day." footnote={queue.lowConfidence ? "kept off the queue" : "every score rests on enough"} />
        <StatTile label="Income known" value={`${stats.incomeKnown.toLocaleString("en-US")} of ${stats.scored.toLocaleString("en-US")}`} labelTitle={coverageText(stats.incomeKnown, stats.scored, stats.affordabilityWeight)} footnote={`worth up to ${stats.affordabilityWeight} points`} />
      </StatStrip>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            <select aria-label="Sort the queue" className={toolbarControl} value={sort} onChange={(e) => router.push(e.target.value === queue.settings.queueDefaultSort ? pathname : `${pathname}?sort=${e.target.value}`)}>
              {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
            <select aria-label="Filter by risk" className={toolbarControl} value={band} onChange={(e) => { setBand(e.target.value); setPage(1); }}>
              <option value="">Every risk level</option>
              {BANDS.filter((b) => b !== "low").map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
            </select>
            {carriers.length > 1 && (
              <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(e) => { setCarrier(e.target.value); setPage(1); }}>
                <option value="">All carriers</option>
                {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            {/* What still needs doing, as chips with their counts; only the ones that hold a card. */}
            {(Object.keys(NEED_LABELS) as Need[]).filter((n) => needCounts[n] > 0).map((n) => (
              <ToggleChip key={n} selected={need === n} count={needCounts[n]} countTone={n === "failed" ? "danger" : "warning"} onClick={() => { setNeed(need === n ? "" : n); setPage(1); }}>{NEED_LABELS[n]}</ToggleChip>
            ))}
          </DataToolbar>
        }
        footer={visible.length ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {queue.usedMedium ? "Nothing is high risk: medium shown · " : ""}
              {queue.heldOut ? `${queue.heldOut.toLocaleString("en-US")} held back for the holdout · ` : ""}
              {queue.computedAt ? `Scored ${fileDay(queue.computedAt.slice(0, 10))}` : null}
            </span>
            <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="policies" onPage={setPage} />
          </div>
        ) : undefined}
      >
        {cards.length === 0 ? (
          <EmptyState title="Nobody to call" hint={queue.lowConfidence ? `${queue.lowConfidence.toLocaleString("en-US")} ${queue.lowConfidence === 1 ? "policy scores" : "policies score"} high on too little: add incomes, set the carriers' grace rules, or wait for a second file.` : stats.scored ? "Nothing paying today scores high enough. Past-due policies are in Lapse risk." : "Scores appear once your carrier policy files are in."} />
        ) : visible.length === 0 ? (
          <NoMatches noun="policies" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[130px]">Risk</th>
                <th>Why, and the fix</th>
                {showWorth && <th className="w-[96px] text-right" title="Unearned advance the carrier takes back if this policy dies (from the commission ledger)">Worth</th>}
                {showDraft && <th className="w-[96px] text-right">Next draft</th>}
                <th className="w-[148px] text-right"><span className="sr-only">Work the card</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.flatMap((card) => {
                const fixes = fixesOf(card);
                const first = fixes[0];
                const firstType = first ? startable(card, first.action) : null;
                const name = card.clientName ? personName(card.clientName) : "No client linked";
                return [
                  <tr key={card.key} className="m-row">
                    <td>
                      <span className="block max-w-[220px] truncate font-semibold text-foreground" title={queue.showOwners && card.owner ? `Owner: ${card.owner.name}` : undefined}>{name}</span>
                      <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={`${card.carrierName} ${card.policyNumber}`}>
                        {card.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(card.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${card.carrierId}/${encodeURIComponent(card.policyNumber)}`} className="hover:underline">{card.carrierName} {card.policyNumber}</Link>
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-baseline gap-1 rounded-full border border-dashed border-current px-2.5 py-0.5 text-xs font-semibold tabular-nums ${BAND_INK[card.band]}`} title={breakdownText(card)}>
                        {card.score} · {card.band[0].toUpperCase() + card.band.slice(1)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground" title={`Predicted, ${card.confidence} confidence.${card.missing.length ? ` Not known: ${card.missing.map((m) => MISSING_LABELS[m as Signal] ?? m).join(", ")}.` : " Every signal is known."}`}>
                        predicted · {card.signalsAvailable} of 7 signals
                      </span>
                    </td>
                    <td className="text-foreground">
                      <span className="line-clamp-2 whitespace-normal" title={card.explanation}>
                        {card.failedFix && <span className="font-semibold text-[var(--error-ink)]">Fix not in the file: {card.failedFix}. </span>}
                        {card.explanation}
                      </span>
                      {card.openRequests.length > 0 ? (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">In progress: {card.openRequests.map((r) => `${REQUEST_LABELS[r.type]} (${STATUS_LABELS[r.status].toLowerCase()})`).join(", ")}</span>
                      ) : first ? (
                        <span className="mt-1 flex min-w-0 items-baseline gap-2 text-xs">
                          <span className="truncate text-[var(--accent-ink)]" title={first.reason}>→ {first.label}</span>
                          {firstType && <button type="button" className="shrink-0 font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline" onClick={() => setFixing({ card, type: firstType })}>Start the fix</button>}
                          {fixes.length > 1 && <span className="shrink-0 text-muted-foreground">+{fixes.length - 1} in ⋯</span>}
                        </span>
                      ) : null}
                    </td>
                    {showWorth && <td className="text-right tabular-nums">{money(card.atRiskCents) ?? <span className="text-muted-foreground" title="No advance from this carrier on file yet">—</span>}</td>}
                    {showDraft && (
                      <td className="text-right tabular-nums">
                        {card.nextDraftDays === null ? <span className="text-muted-foreground" title="The draft day is known only for sales written in the app">—</span> : card.nextDraftDays === 0 ? "Today" : `${card.nextDraftDays} ${card.nextDraftDays === 1 ? "day" : "days"}`}
                      </td>
                    )}
                    <td className="text-right">
                      {!readOnly && (
                        <span className="inline-flex items-center justify-end gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => setLogging(card)}>Log call</Button>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${name}`} title="More"><MoreHorizontal aria-hidden="true" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {fixes.slice(1).map((f) => {
                                const type = startable(card, f.action);
                                return type ? <DropdownMenuItem key={f.action} onSelect={() => setFixing({ card, type })}>Start: {f.label}</DropdownMenuItem> : null;
                              })}
                              {/* A known income can be corrected or removed too (live test 2026-11-02: there was no way back). */}
                              <DropdownMenuItem onSelect={() => setIncomeFor(card.key)}>{card.incomeKnown ? "Change income" : "Add income"}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setHolding(card)}>Snooze or dismiss</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      )}
                    </td>
                  </tr>,
                  incomeFor === card.key ? (
                    <tr key={`${card.key}-income`}>
                      <td colSpan={cols}>
                        <div className="flex max-w-[640px] items-start gap-3 py-1">
                          <div className="min-w-0 flex-1">
                            <IncomeCapture
                              compact
                              readUrl={`/api/app/retention/income?carrier_id=${card.carrierId}&policy_number=${encodeURIComponent(card.policyNumber)}`}
                              save={(income) => fetch("/api/app/retention/income", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: card.carrierId, policy_number: card.policyNumber, income }) })}
                              onSaved={() => { setIncomeFor(null); router.refresh(); }}
                            />
                          </div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setIncomeFor(null)}>Close</Button>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {logging && <LogDialog card={logging} onClose={() => setLogging(null)} onDone={() => { setLogging(null); router.refresh(); }} />}
      {fixing && <ServicingRequestDialog carrierId={fixing.card.carrierId} policyNumber={fixing.card.policyNumber} type={fixing.type} origin="save_queue" fromQueue onClose={() => setFixing(null)} onDone={() => { setFixing(null); router.refresh(); }} />}
      {holding && <HoldDialog card={holding} onClose={() => setHolding(null)} onDone={() => { setHolding(null); router.refresh(); }} />}
    </>
  );
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/retention/save-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
  return data;
}

function LogDialog({ card, onClose, onDone }: { card: SaveCard; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<ContactOutcome | "">("");
  const [clientReason, setClientReason] = useState<ClientReason | "">("");
  const [action, setAction] = useState<ActionTaken>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = card.fixes.map((f) => f.action as ActionTaken);
  const actions = [...new Set<ActionTaken>([...suggested, ...ACTION_TAKEN])];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "log_attempt", carrier_id: card.carrierId, policy_number: card.policyNumber, outcome, action_taken: action, note: note.trim() || null, client_reason: outcome === "reached_refused" && clientReason ? clientReason : null });
      notify.done("Logged. It leaves the queue until the cooldown ends, or the risk rises.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Log the call to {card.clientName ? personName(card.clientName) : card.policyNumber}</DialogTitle>
          <DialogDescription>Risk {card.score} · {card.band}, recorded as it is now.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label htmlFor="save-outcome" className={labelClass}>
            What happened
            <select id="save-outcome" className={field} value={outcome} onChange={(e) => { const next = e.target.value as ContactOutcome; setOutcome(next); if (next === "reached_agreed" && action === "none" && suggested[0]) setAction(suggested[0]); }}>
              <option value="">Choose…</option>
              {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{CONTACT_OUTCOME_LABELS[o]}</option>)}
            </select>
          </label>
          {outcome === "reached_refused" && (
            <label htmlFor="save-client-reason" className={labelClass}>
              Why they said no
              <select id="save-client-reason" className={field} value={clientReason} onChange={(e) => setClientReason(e.target.value as ClientReason | "")}>
                <option value="">They didn&apos;t say, or something else</option>
                {CLIENT_REASONS.map((r) => <option key={r} value={r}>{CLIENT_REASON_LABELS[r]}</option>)}
              </select>
            </label>
          )}
          <label htmlFor="save-action" className={labelClass}>
            What you did
            <select id="save-action" className={field} value={action} onChange={(e) => setAction(e.target.value as ActionTaken)}>
              {actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}{suggested.includes(a) ? " (suggested)" : ""}</option>)}
            </select>
          </label>
          <label htmlFor="save-note" className={labelClass}>
            Note
            <textarea id="save-note" className={`${field} min-h-20 py-2`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!outcome || busy} onClick={() => void save()}>{busy ? "Saving…" : "Log the call"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldDialog({ card, onClose, onDone }: { card: SaveCard; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"snooze" | "dismiss">("snooze");
  const [days, setDays] = useState<number>(SNOOZE_DAYS[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await post({ action: "hold", carrier_id: card.carrierId, policy_number: card.policyNumber, kind, reason: reason.trim(), days: kind === "snooze" ? days : null });
      notify.done(kind === "snooze" ? `Snoozed for ${days} days. It comes back sooner if the risk rises.` : "Dismissed. It comes back only if the risk rises.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Take {card.clientName ? personName(card.clientName) : card.policyNumber} off the queue</DialogTitle>
          <DialogDescription>Say why, so it is known next time.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label htmlFor="hold-kind" className={labelClass}>
            For how long
            <select id="hold-kind" className={field} value={kind === "dismiss" ? "dismiss" : String(days)} onChange={(e) => { if (e.target.value === "dismiss") setKind("dismiss"); else { setKind("snooze"); setDays(Number(e.target.value)); } }}>
              {SNOOZE_DAYS.map((d) => <option key={d} value={d}>Snooze {d} days</option>)}
              <option value="dismiss">Dismiss until the risk rises</option>
            </select>
          </label>
          <label htmlFor="hold-reason" className={labelClass}>
            Reason
            <textarea id="hold-reason" className={`${field} min-h-20 py-2`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => void save()}>{busy ? "Saving…" : kind === "snooze" ? "Snooze" : "Dismiss"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
