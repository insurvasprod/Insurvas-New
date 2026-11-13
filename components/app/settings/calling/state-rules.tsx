"use client";

/**
 * Settings › Calling windows (round 8) — "State rules in force" beside the week, and the full rules
 * per state behind its link. Picking a state draws its cut-offs on the grid. Read-only: these are the
 * platform's to maintain, and the dialer always obeys the stricter rule.
 */

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { US_STATES } from "@/lib/appointments/constants";
import { effectiveMinutes, minuteLabel, type MinuteWindow, type RulesFeed, type StateRuleInForce } from "@/lib/callingWindow/engine";
import { minutesLabel, ruleLine, weekCut, type Week } from "@/lib/callingWindows/week";
import { cn } from "@/lib/utils";

import { BoardCard, CardFoot } from "./parts";

const STATE_NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
export const stateName = (code: string) => STATE_NAMES.get(code) ?? code;

export function StateRulesCard({
  rules,
  week,
  noSunday,
  selected,
  onSelect,
  onOpenAll,
  available,
  onRetry,
}: {
  rules: StateRuleInForce[];
  week: Week;
  noSunday: boolean;
  selected: string | null;
  onSelect: (state: string | null) => void;
  onOpenAll: () => void;
  available: boolean;
  onRetry: () => void;
}) {
  return (
    <BoardCard
      label="State rules in force"
      title="State rules in force"
      right={available ? <span className="text-xs text-[var(--muted)]">{rules.length} {rules.length === 1 ? "state" : "states"} · set by law</span> : undefined}
      className="max-h-[300px] shrink"
      footer={
        <CardFoot>
          The dialer always obeys the stricter rule ·
          <button type="button" className="font-medium text-[var(--accent-ink)] hover:underline" onClick={onOpenAll}>full rules per state</button>
        </CardFoot>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!available ? (
          <p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">
            Couldn&rsquo;t load state rules. The dialer still obeys them.{" "}
            <button type="button" className="font-medium text-[var(--accent-ink)] hover:underline" onClick={onRetry}>Retry</button>
          </p>
        ) : rules.length === 0 ? (
          <p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">No state narrows your hours beyond federal law.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rules.map((rule) => {
              const cut = weekCut(week, noSunday, rule);
              const on = selected === rule.state;
              return (
                <li key={rule.state}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={`${stateName(rule.state)}${on ? " — shown on the grid" : " — show on the grid"}`}
                    onClick={() => onSelect(on ? null : rule.state)}
                    className={cn(
                      "flex w-full items-center gap-2.5 border-b border-border px-4 py-2 text-left text-sm hover:bg-[var(--surface-alt)]",
                      on && "bg-[var(--primary-soft)] shadow-[inset_2px_0_0_var(--primary)]",
                    )}
                  >
                    <b className="w-7 text-xs font-semibold text-[var(--ink)]">{rule.state}</b>
                    <span className="min-w-0 flex-1 truncate text-[var(--body)]">{ruleLine(rule)}</span>
                    {cut > 0 ? <StatusChip tone="warning">Cuts {minutesLabel(cut)}</StatusChip> : <span className="text-xs text-[var(--muted)]">Fits</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BoardCard>
  );
}

/** Every state the agency works in, with what the law allows and what the dialer uses with your hours. */
export function StateRulesSheet({
  rules,
  base,
  everyStateBansHolidays,
  readsFederalHolidays,
  feed,
  basis,
  onClose,
}: {
  rules: StateRuleInForce[];
  base: MinuteWindow | null;
  everyStateBansHolidays: boolean;
  readsFederalHolidays: boolean;
  feed: RulesFeed | null;
  basis: "worked" | "notable";
  onClose: () => void;
}) {
  const refreshed = feed ? new Date(feed.lastRefreshedAt) : null;
  const refreshedLabel =
    refreshed && !Number.isNaN(refreshed.getTime())
      ? `${refreshed.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${refreshed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : null;
  return (
    <Sheet
      title="Full rules per state"
      subtitle={basis === "worked" ? "The states your agency works in" : "The states whose rule is tighter than your hours"}
      status={feed?.stale ? <StatusChip tone="danger">Out of date · dialing is blocked</StatusChip> : undefined}
      onClose={onClose}
      footer={<div className="flex justify-end"><Button type="button" onClick={onClose}>Done</Button></div>}
      bodyClassName="flex flex-col gap-0 p-0"
    >
      <div className="flex items-center gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-2 text-xs text-[var(--muted)]">
        <span className="w-[120px]">State</span>
        <span className="flex-1">Law allows</span>
        <span>Dialer uses</span>
      </div>
      <ul className="m-0 list-none p-0">
        {rules.map((rule) => {
          const law = effectiveMinutes(rule, null, null);
          const used = effectiveMinutes(rule, base, null);
          const closed = used.start >= used.end;
          return (
            <li key={rule.state} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm text-[var(--body)]">
              <span className="w-[120px] truncate font-medium text-[var(--ink)]">{stateName(rule.state)}</span>
              <span className="min-w-0 flex-1 truncate">
                {minuteLabel(law.start)} – {minuteLabel(law.end)}
                {rule.noSunday ? " · no Sundays" : ""}
                {rule.noHolidays && !everyStateBansHolidays ? " · no holidays" : ""}
              </span>
              {closed ? <StatusChip tone="danger">Closed</StatusChip> : <span className="whitespace-nowrap tabular-nums">{minuteLabel(used.start)} – {minuteLabel(used.end)}</span>}
            </li>
          );
        })}
      </ul>
      <p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">
        {feed && refreshedLabel ? `Last refreshed ${refreshedLabel}.` : "Refresh time not recorded yet."}
        {feed?.stale ? " These rules are out of date, so the dialer refuses every dial until they are refreshed." : ""}
        {everyStateBansHolidays && (readsFederalHolidays ? " State and federal holidays are always blocked." : " State holidays are always blocked.")}
        {" "}Every time is the customer&rsquo;s local time.
      </p>
    </Sheet>
  );
}
