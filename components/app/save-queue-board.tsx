"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, ClearFiltersButton, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { MoreMenu } from "@/components/ui/more-menu";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { BANDS, MISSING_LABELS, SIGNAL_LABELS, type Band, type Signal } from "@/lib/retention/constants";
import { SORT_LABELS, SORTS, type QueueSort } from "@/lib/retention/queue";
import { REQUEST_FOR_FIX, REQUEST_LABELS, STATUS_LABELS, type RequestType } from "@/lib/retention/servicing";
import { coverageText } from "@/lib/retention/income";
import type { SaveCard, SaveQueue } from "@/lib/retention/queueStore";
import { cardHref, HoldDialog } from "@/components/app/retention/save-card";

// Whole dollars, rounded (it used to cut the cents off: $0.99 read $0).
const money = (cents: number | null) => {
  if (cents === null) return null;
  return `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
};
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
/** LA-5.2's audit trail: what each known sign added, which sums to the score. */
const breakdownText = (card: SaveCard) =>
  ["A prediction from the chargeback radar, not something the carrier reported.", ...card.contributions.map((c) => `${SIGNAL_LABELS[c.signal]}: +${c.contribution}`), `Score ${card.score}`].join("\n");

const BAND_INK: Record<Band, string> = { critical: "text-[var(--error-ink)]", high: "text-[var(--warning-ink)]", medium: "text-[var(--info-ink)]", low: "text-muted-foreground" };
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What a card still needs before it can be worked well (owner 2026-11-02: "help the agent if there's things to fix"). */
type Need = "failed" | "phone" | "income";
const NEEDS: Need[] = ["failed", "phone", "income"];
const NEED_LABELS: Record<Need, string> = { failed: "Fix not in the file", phone: "No phone", income: "No income" };
const needsOf = (card: SaveCard): Need[] => [...(card.failedFix ? ["failed" as const] : []), ...(card.phone ? [] : ["phone" as const]), ...(card.incomeKnown ? [] : ["income" as const])];

/**
 * LA-5.3 (Notion sprint) · the save queue. A prediction, drawn as one: the risk sits in a dashed
 * outline and always says how many signals it rests on, so it can never be taken for Lapse risk's
 * observed facts. Phone on the row; the reason is the opening line.
 *
 * The pick of 2026-11-05 ("SqA", docs/retention/CRITIQUE.md): the row's button is the fix itself, and the
 * name opens the card's page, where the call is logged, the fix is sent, income is kept. Snooze or dismiss
 * stays a confirm (⋯). Filters sit behind one Filters button and live in the address (`band`, `carrier`,
 * `need`), so every tile is a link to its slice of the queue.
 */
export function SaveQueueBoard({ queue, sort, readOnly, canStartFix }: { queue: SaveQueue; sort: QueueSort; readOnly: boolean; canStartFix: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [holding, setHolding] = useState<SaveCard | null>(null);

  const band = (BANDS as readonly string[]).includes(params.get("band") ?? "") ? (params.get("band") as Band) : "";
  const carrier = params.get("carrier") ?? "";
  const need = (NEEDS as string[]).includes(params.get("need") ?? "") ? (params.get("need") as Need) : "";
  /** One filter changed, the address follows (the sort and the others are kept). */
  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) if (value) next.set(key, value); else next.delete(key);
    return next.size ? `${pathname}?${next}` : pathname;
  };
  const setParam = (changes: Record<string, string | null>) => { setPage(1); router.replace(hrefWith(changes), { scroll: false }); };

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
  const chips: ActiveFilter[] = [
    ...(band ? [{ key: "band", label: "Risk", value: capital(band), onRemove: () => setParam({ band: null }) }] : []),
    ...(carrier ? [{ key: "carrier", label: "Carrier", value: carriers.find(([id]) => id === carrier)?.[1] ?? "Carrier", onRemove: () => setParam({ carrier: null }) }] : []),
    ...(need ? [{ key: "need", label: "Still needs", value: NEED_LABELS[need], onRemove: () => setParam({ need: null }) }] : []),
  ];
  const clear = () => { setSearch(""); setParam({ band: null, carrier: null, need: null }); };
  const fixesOf = (card: SaveCard) => card.fixes.filter((f) => !(card.noBankAccount && f.action === "convert_to_draft"));
  // A column every card leaves empty says nothing (owner 2026-11-02 critique): drawn only once one card has it.
  const showWorth = cards.some((c) => c.atRiskCents !== null);
  const showDraft = cards.some((c) => c.nextDraftDays !== null);
  const startable = (card: SaveCard, action: string): RequestType | null => {
    const type = (REQUEST_FOR_FIX as Record<string, RequestType | undefined>)[action];
    return type && canStartFix && !readOnly && !card.openRequests.some((r) => r.type === type) ? type : null;
  };
  const known = cards.length - stats.atRiskUnknown;

  return (
    <>
      {/* Every tile opens its slice of the queue (owner rule: figures are links). */}
      {stats.scored > 0 && <StatStrip label="Save queue">
        <StatTile label="In the queue" href={pathname} value={queue.total.toLocaleString("en-US")} footnote={queue.total > cards.length ? `first ${cards.length} shown` : `of ${stats.scored.toLocaleString("en-US")} scored`} />
        <StatTile label="Critical" href={hrefWith({ band: "critical" })} value={stats.queueCritical.toLocaleString("en-US")} valueTone={stats.queueCritical ? "danger" : undefined} labelTitle="Critical cards on the queue. Across the book, past-due and worked policies included, the radar scores more; past-due ones are in Lapse risk." footnote={`${stats.critical.toLocaleString("en-US")} across the book`} />
        {/* When most of the queue has no advance on file, the unknown leads: "$0" alone read as nothing at stake. */}
        <StatTile label="Advance at risk" href={hrefWith({ sort: "exposure" })} value={!cards.length ? "—" : known === 0 ? "Not on file" : stats.atRiskUnknown > known ? `${stats.atRiskUnknown} unknown` : money(stats.atRiskCents)} valueTone={cards.length && stats.atRiskUnknown > known ? "warning" : undefined}
          footnote={!cards.length ? "nothing in the queue" : known === 0 ? "no advance from these carriers yet" : stats.atRiskUnknown > known ? `${money(stats.atRiskCents)} on the ${known} with an advance` : stats.atRiskUnknown ? `${stats.atRiskUnknown} with no advance on file` : "unearned, in the queue"} />
        <StatTile label="Too little known" href="/app/retention-settings" value={queue.lowConfidence.toLocaleString("en-US")} labelTitle="High or critical, but scored on under half the signals. They stay off the queue until more is known: income, the carrier's grace rule, a second carrier file, the draft day." footnote={queue.lowConfidence ? "kept off the queue" : "every score rests on enough"} />
        <StatTile label="Income known" href={hrefWith({ need: "income" })} value={`${stats.incomeKnown.toLocaleString("en-US")} of ${stats.scored.toLocaleString("en-US")}`} labelTitle={coverageText(stats.incomeKnown, stats.scored, stats.affordabilityWeight)} footnote={`worth up to ${stats.affordabilityWeight} points`} />
      </StatStrip>}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(chips.length > 0 || needle) && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            <FilterButton open={filtersOpen} count={chips.length} controls="save-queue-filters" onClick={() => setFiltersOpen(!filtersOpen)} />
            <select aria-label="Sort the queue" className={toolbarControl} value={sort} onChange={(e) => router.push(hrefWith({ sort: e.target.value === queue.settings.queueDefaultSort ? null : e.target.value }))}>
              {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </DataToolbar>
        }
        filters={<>
          <FilterPanel id="save-queue-filters" open={filtersOpen}>
            <FilterField label="Risk" htmlFor="sq-band"><select id="sq-band" className={toolbarControl} value={band} onChange={(e) => setParam({ band: e.target.value || null })}>
              <option value="">Every risk level</option>
              {BANDS.filter((b) => b !== "low").map((b) => <option key={b} value={b}>{capital(b)}</option>)}
            </select></FilterField>
            {carriers.length > 1 && <FilterField label="Carrier" htmlFor="sq-carrier"><select id="sq-carrier" className={toolbarControl} value={carrier} onChange={(e) => setParam({ carrier: e.target.value || null })}>
              <option value="">All carriers</option>
              {carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></FilterField>}
            <FilterField label="Still needs" htmlFor="sq-need"><select id="sq-need" className={toolbarControl} value={need} onChange={(e) => setParam({ need: e.target.value || null })}>
              <option value="">Anything</option>
              {NEEDS.map((n) => <option key={n} value={n} disabled={!needCounts[n]}>{NEED_LABELS[n]} · {needCounts[n]}</option>)}
            </select></FilterField>
          </FilterPanel>
          <ActiveFilters filters={chips} onClear={clear} />
        </>}
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
                <th className="w-[160px] text-right"><span className="sr-only">Work the card</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((card) => {
                const fixes = fixesOf(card);
                const first = fixes[0];
                const firstType = first ? startable(card, first.action) : null;
                const name = card.clientName ? personName(card.clientName) : "No client linked";
                const href = cardHref(card);
                return (
                  <tr key={card.key} className="m-row">
                    <td>
                      <Link href={href} className="block max-w-[220px] truncate font-semibold text-foreground underline-offset-2 hover:underline" title={queue.showOwners && card.owner ? `Owner: ${card.owner.name}` : undefined}>{name}</Link>
                      <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={`${card.carrierName} ${card.policyNumber}`}>
                        {card.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(card.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${card.carrierId}/${encodeURIComponent(card.policyNumber)}`} className="hover:underline">{card.carrierName} {card.policyNumber}</Link>
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-baseline gap-1 rounded-full border border-dashed border-current px-2.5 py-0.5 text-xs font-semibold tabular-nums ${BAND_INK[card.band]}`} title={breakdownText(card)}>
                        {card.score} · {capital(card.band)}
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
                        <span className="mt-1 block truncate text-xs text-[var(--accent-ink)]" title={first.reason}>→ {first.label}{fixes.length > 1 ? <span className="text-muted-foreground"> · +{fixes.length - 1} more</span> : null}</span>
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
                          {/* The fix is the row's job (spec card: [Call] [Start the fix]); without one, the call. */}
                          {firstType
                            ? <Button asChild size="sm"><Link href={`${href}?tab=fix&fix=${firstType}`}>Start the fix</Link></Button>
                            : <Button asChild size="sm" variant="outline"><Link href={`${href}?tab=calls`}>Log call</Link></Button>}
                          <MoreMenu row label={`More for ${name}`} items={[
                            ...fixes.slice(1).map((f) => { const type = startable(card, f.action); return type ? { label: `Start: ${f.label}`, href: `${href}?tab=fix&fix=${type}` } : null; }),
                            firstType && { label: "Log call", href: `${href}?tab=calls` },
                            // A known income can be corrected or removed too (live test 2026-11-02: there was no way back).
                            { label: card.incomeKnown ? "Change income" : "Add income", href: `${href}?tab=income` },
                            { label: "Snooze or dismiss", onSelect: () => setHolding(card) },
                          ]} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {holding && <HoldDialog card={holding} onClose={() => setHolding(null)} onDone={() => { setHolding(null); router.refresh(); }} />}
    </>
  );
}
