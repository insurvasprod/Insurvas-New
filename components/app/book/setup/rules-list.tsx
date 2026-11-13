"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { EVENT_LABELS, RULE_EVENTS, type RuleEvent } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, RuleListItem } from "@/lib/pipelineRules/store";
import { cn } from "@/lib/utils";

import { BUCKET_LABEL, bucketOf, RULES_HREF, rulePageHref, stageNames, type RuleBucket } from "./card-moves-shared";
import { LinkRow } from "./link-row";

const LINK = "hover:underline";
/** A rule's mode in words (the All tab's plain Mode column; the row's one chip is To check). */
const modeWord = (rule: RuleListItem) => (!rule.enabled ? "Off" : rule.mode === "live" ? "Live" : rule.mode === "forecast" ? "Forecast" : "Draft");
const HELD_HREF = "/app/needs-you?view=agency";

/**
 * Carrier sync › Card moves, the list (mockup r7 §2 direction A "By mode", owner 2026-11-10). The modes are the
 * sub-page bar (the server page draws it); this is the tab's table. Today's warning callout became counts where they
 * belong: a forecast rule's "To check", "1 held" on its rule (opens Needs you), a stopped run on the Live tab's line.
 * One row a rule, one line, the whole row is the link (board 10). A held move or a stopped run is the row's one chip.
 */
export function RulesList({ rules, bucket, toCheck, board, carriers, capped, canCreate }: {
  rules: RuleListItem[];
  bucket: RuleBucket;
  /** Forecast rules: the would-moves of the last 7 days nobody has marked Right or Wrong yet. */
  toCheck: Record<string, number>;
  board: BoardPipeline[];
  carriers: Array<{ id: string; name: string }>;
  /** The last run stopped at the cap with live moves left: the cap, or null. */
  capped: number | null;
  canCreate: boolean;
}) {
  const stages = useMemo(() => stageNames(board), [board]);
  const carrierName = useMemo(() => new Map(carriers.map((c) => [c.id, c.name])), [carriers]);
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [event, setEvent] = useState<RuleEvent | "">("");
  // Owner 2026-11-10: the card ends at the window's foot; search and filters stay put and the rows scroll inside it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "";
      if (window.innerWidth < 1024) return;
      const bottom = fillLine(el) ?? window.innerHeight - 32;
      el.style.height = `${Math.max(360, Math.floor(bottom - el.getBoundingClientRect().top - 2))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const inTab = rules.filter((rule) => bucket === "all" || bucketOf(rule) === bucket);
  const q = query.trim().toLowerCase();
  const shown = inTab.filter((rule) => {
    const v = rule.current;
    if (q && !rule.name.toLowerCase().includes(q)) return false;
    if (carrier && v && v.carrierIds.length > 0 && !v.carrierIds.includes(carrier)) return false;
    if (event && v?.event !== event) return false;
    return true;
  });
  const events = RULE_EVENTS.filter((e) => rules.some((r) => r.current?.event === e));
  const clear = () => { setQuery(""); setCarrier(""); setEvent(""); };

  // Round 6 (owner 2026-11-06): past two names a cell reads "9 stages", the names in its tooltip.
  const list = (ids: string[], none: string, name: (id: string) => string, noun: string) => {
    if (!ids.length) return none;
    const names = [...new Set(ids.map(name))];
    return names.length <= 2 ? names.join(", ") : <span title={names.join(", ")} className="underline decoration-dotted underline-offset-4">{names.length} {noun}</span>;
  };
  const from = bucket === "all" ? null : bucket;

  function lastSeven(rule: RuleListItem) {
    const live = rule.mode === "live" && rule.enabled;
    if (live) return rule.last7.moved ? <span>{rule.last7.moved.toLocaleString("en-US")} moved</span> : <span className="text-muted-foreground">—</span>;
    return rule.last7.wouldMove ? <Link href={rulePageHref(rule.id, { from, tab: "check" })} className={LINK}>would move {rule.last7.wouldMove.toLocaleString("en-US")}</Link> : <span className="text-muted-foreground">—</span>;
  }

  /** The row's one chip: a stopped run, then a held move (opens Needs you), then the forecast's checks. */
  function checkCell(rule: RuleListItem) {
    const live = rule.mode === "live" && rule.enabled;
    if (live && capped !== null) return <StatusChip tone="danger" title={`The last run stopped at ${capped} moves`}>{`Stopped at ${capped}`}</StatusChip>;
    if (rule.last7.held > 0) return <Link href={HELD_HREF} title="Two rules disagree: settle it in Needs you"><StatusChip tone="warning">{`${rule.last7.held} held`}</StatusChip></Link>;
    if (bucketOf(rule) !== "forecast") return <span className="text-muted-foreground">—</span>;
    const open = toCheck[rule.id] ?? 0;
    if (open > 0) return <StatusChip tone="warning">{open.toLocaleString("en-US")} not checked</StatusChip>;
    return rule.last7.wouldMove > 0 ? <StatusChip tone="good">all checked</StatusChip> : <span className="text-muted-foreground" title="Nothing yet">—</span>;
  }

  const empty = rules.length === 0 ? (
    <EmptyState title="No card-move rules yet" hint="A rule moves a lead's card when something happens to its policy, and adds a note. It starts in forecast: it records what it would do and moves nothing until you switch it to live." action={canCreate ? <Link href={`${RULES_HREF}/new`} className={buttonVariants()}>New rule</Link> : undefined} />
  ) : inTab.length === 0 ? (
    bucket === "live" ? <EmptyState title="No rule is live" hint="No rule is on, so no card moves. Open a forecast rule and switch it to live." action={<Link href={`${RULES_HREF}?mode=forecast`} className={buttonVariants({ variant: "outline" })}>Show Forecast</Link>} />
    : bucket === "forecast" ? <EmptyState title="No rule in forecast" hint="A new rule starts in forecast: it records what it would do and moves nothing until you switch it to live." />
    : bucket === "off" ? <EmptyState title="No rule is off" hint="A rule you turn off stops moving cards and recording what it would do. Turn it on again any time." />
    : <EmptyState title="No draft rule" hint="Every rule saved here starts in forecast." />
  ) : shown.length === 0 ? <NoMatches noun="rules" onClear={clear} by={q && !carrier && !event ? "search" : "filters"} /> : null;

  const hint = bucket === "live" && capped !== null
    ? <span className="text-xs text-foreground">The last run stopped at {capped} moves: look before the rest move.</span>
    : <span className="text-xs text-muted-foreground">A forecast rule moves nothing: it records what it would do.</span>;

  return (
    <div ref={box} className="flex min-h-0 flex-col">
    <TableCard
      className="min-h-0 flex-1"
      bodyClassName="min-h-0 overflow-y-auto"
      toolbar={rules.length > 0 ? (
        <DataToolbar actions={hint}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search rules" />
          <select aria-label="Carrier" className={cn(toolbarControl, "w-full sm:w-44")} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            <option value="">Every carrier</option>
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Event" className={cn(toolbarControl, "w-full sm:w-44")} value={event} onChange={(e) => setEvent(e.target.value as RuleEvent | "")}>
            <option value="">Every event</option>
            {events.map((e) => <option key={e} value={e}>{EVENT_LABELS[e].label}</option>)}
          </select>
        </DataToolbar>
      ) : undefined}
      footer={rules.length > 0 && !empty ? <span className="text-xs text-muted-foreground">{shown.length} of {rules.length} {rules.length === 1 ? "rule" : "rules"}{bucket !== "all" ? ` · ${BUCKET_LABEL[bucket]}` : ""}</span> : undefined}
    >
      {empty ?? (
        <>
          <table className="portal-lead-table hidden w-full min-w-[960px] text-left text-sm sm:table">
            <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:!bg-[var(--surface-alt)]">
              <tr>
                <th>Rule</th><th>Carriers</th><th title="The stages it moves from are on hover">Moves to</th>
                {bucket === "all" && <th className="w-[100px]">Mode</th>}
                <th className="w-[170px]">Last 7 days</th><th className="w-[140px]">To check</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((rule) => {
                const v = rule.current;
                const to = v ? stages.get(v.targetStageId) : null;
                const href = rulePageHref(rule.id, { from });
                return (
                  <LinkRow key={rule.id} href={href}>
                    <td className="whitespace-nowrap" title={v ? `${EVENT_LABELS[v.event].label} · ${v.noteOn ? "adds a note" : "no note"}` : "No version"}>
                      <Link href={href} className="font-medium text-foreground hover:underline">{rule.name}</Link>
                    </td>
                    <td className="whitespace-nowrap">{v ? list(v.carrierIds, "Every carrier", (id) => carrierName.get(id) ?? "a carrier", "carriers") : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap" title={v ? `From ${v.fromStageIds.length ? [...new Set(v.fromStageIds.map((id) => stages.get(id)?.stage ?? "a stage"))].join(", ") : "any stage"}` : undefined}>{to ? `${to.pipeline} › ${to.stage}` : "A stage no longer on the board"}</td>
                    {bucket === "all" && <td className="whitespace-nowrap">{modeWord(rule)}</td>}
                    <td className="whitespace-nowrap tabular-nums">{lastSeven(rule)}</td>
                    <td>{checkCell(rule)}</td>
                  </LinkRow>
                );
              })}
            </tbody>
          </table>
          {/* Phone (mockup 2·7): one card a rule, the same facts stacked. */}
          <ul className="m-0 list-none divide-y divide-border p-0 sm:hidden">
            {shown.map((rule) => {
              const v = rule.current;
              const fromText = v ? (v.fromStageIds.length ? `from ${v.fromStageIds.length === 1 ? stages.get(v.fromStageIds[0])?.stage ?? "a stage" : `${v.fromStageIds.length} stages`}` : "any stage") : "";
              const carriersText = v ? (v.carrierIds.length === 0 ? "Every carrier" : v.carrierIds.length === 1 ? carrierName.get(v.carrierIds[0]) ?? "1 carrier" : `${v.carrierIds.length} carriers`) : "";
              return (
                <li key={rule.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <Link href={rulePageHref(rule.id, { from })} className="font-medium leading-snug text-foreground hover:underline">{rule.name}</Link>
                  <span className="text-xs text-muted-foreground">{carriersText}{fromText ? ` · ${fromText}` : ""}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{lastSeven(rule)}</span>{checkCell(rule)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </TableCard>
    </div>
  );
}
