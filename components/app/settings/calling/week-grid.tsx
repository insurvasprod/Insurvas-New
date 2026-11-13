"use client";

/**
 * Settings › Calling windows (round 8) — the week you call, as blocks on a 7 am–10 pm grid.
 *
 * Agency mode: one block per open weekday. Drag its top or bottom edge (quarter hours, the time shows
 * as you drag), drag across an empty day to add hours, right-click a day (or open its name) to copy it
 * to the whole week or make it a day off. A picked state's cut-offs are drawn over the blocks.
 *
 * Campaign mode (the campaign sheet's mini week): the agency's hours are a hatched ghost and the
 * campaign's one window is drawn inside them; dragging an edge moves that window on every day.
 *
 * Edges are buttons too: focus one and use the arrow keys, 15 minutes a press.
 */

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MinuteWindow, StateRuleInForce } from "@/lib/callingWindow/engine";
import {
  GRID,
  GRID_ORDER,
  STEP_MINUTES,
  WEEKDAYS,
  WEEKDAY_SHORT,
  clock,
  drawnDay,
  gridFraction,
  moveEdge,
  stateCut,
  type Week,
} from "@/lib/callingWindows/week";
import { cn } from "@/lib/utils";

/** The board's hatches, from tokens (no gradient classes: the glow ratchet). */
export const HATCH = {
  state: { backgroundImage: "repeating-linear-gradient(135deg, var(--warning-surface) 0 5px, var(--surface) 5px 10px)" },
  off: { backgroundImage: "repeating-linear-gradient(135deg, var(--surface-alt) 0 6px, transparent 6px 12px)" },
  ghost: { backgroundImage: "repeating-linear-gradient(135deg, var(--surface-alt) 0 5px, transparent 5px 10px)" },
} satisfies Record<string, CSSProperties>;

const HOUR_MARKS = [7, 10, 13, 16, 19, 22];
const MINI_MARKS = [7, 13, 19, 22];
const RULES = { backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(100% / 15 - 1px), var(--border) calc(100% / 15 - 1px), var(--border) calc(100% / 15))" };

const pct = (minute: number) => `${gridFraction(minute) * 100}%`;
const height = (window: MinuteWindow) => `${(gridFraction(window.end) - gridFraction(window.start)) * 100}%`;
const hourLabel = (hour: number) => (hour === 12 ? "noon" : `${hour % 12 || 12} ${hour < 12 ? "am" : "pm"}`);

type Drag = { weekday: number; edge: "start" | "end" | "draw"; from: number; rect: DOMRect };

export function WeekGrid({
  week,
  noSunday,
  editable,
  onDay,
  onCopy,
  rule,
  stateCode,
  mini = false,
  campaign,
  onCampaign,
  label,
}: {
  /** The agency's days (null = a day off). In campaign mode, the ghost. */
  week: Week;
  noSunday: boolean;
  editable: boolean;
  onDay?: (weekday: number, day: MinuteWindow | null) => void;
  onCopy?: (weekday: number) => void;
  /** A picked state's rule, drawn over the blocks. */
  rule?: StateRuleInForce;
  stateCode?: string;
  mini?: boolean;
  /** Campaign mode: the campaign's one window, drawn inside the agency's ghost on each open day. */
  campaign?: MinuteWindow | null;
  onCampaign?: (window: MinuteWindow) => void;
  label: string;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<{ weekday: number; day: MinuteWindow } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const campaignMode = campaign !== undefined;
  const marks = mini ? MINI_MARKS : HOUR_MARKS;

  const minuteAt = (clientY: number, rect: DOMRect) => GRID.start + ((clientY - rect.top) / rect.height) * (GRID.end - GRID.start);
  const offBySwitch = (weekday: number) => weekday === 0 && noSunday;

  function begin(event: PointerEvent<HTMLElement>, weekday: number, edge: Drag["edge"]) {
    if (!editable || event.button !== 0) return;
    const column = event.currentTarget.closest("[data-day-column]");
    if (!column) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = column.getBoundingClientRect();
    setDrag({ weekday, edge, from: minuteAt(event.clientY, rect), rect });
  }

  function shown(weekday: number): MinuteWindow | null {
    if (draft && draft.weekday === weekday) return draft.day;
    if (campaignMode) {
      const ghost = week[weekday];
      const window = draft && draft.weekday === -1 ? draft.day : campaign;
      if (!ghost || !window || offBySwitch(weekday)) return null;
      const start = Math.max(ghost.start, window.start);
      const end = Math.min(ghost.end, window.end);
      return start < end ? { start, end } : null;
    }
    return week[weekday];
  }

  function move(event: PointerEvent<HTMLElement>) {
    if (!drag) return;
    const at = minuteAt(event.clientY, drag.rect);
    if (drag.edge === "draw") { setDraft({ weekday: drag.weekday, day: drawnDay(drag.from, at) }); return; }
    const base = campaignMode ? (draft?.weekday === -1 ? draft.day : campaign) : week[drag.weekday];
    if (!base) return;
    const current = draft && (draft.weekday === drag.weekday || draft.weekday === -1) ? draft.day : base;
    const next = moveEdge(current, drag.edge, at);
    setDraft({ weekday: campaignMode ? -1 : drag.weekday, day: next });
  }

  function end() {
    if (drag && draft) {
      if (campaignMode) onCampaign?.(draft.day);
      else onDay?.(draft.weekday, draft.day);
    }
    setDrag(null);
    setDraft(null);
  }

  function keyEdge(event: KeyboardEvent<HTMLElement>, weekday: number, edge: "start" | "end") {
    if (!editable || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const base = campaignMode ? campaign : week[weekday];
    if (!base) return;
    const delta = event.key === "ArrowUp" ? -STEP_MINUTES : STEP_MINUTES;
    const next = moveEdge(base, edge, base[edge] + delta);
    if (campaignMode) onCampaign?.(next);
    else onDay?.(weekday, next);
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("grid h-full gap-x-2", mini ? "min-h-[250px] grid-cols-[40px_repeat(7,minmax(0,1fr))] gap-x-1.5" : "min-h-[360px] grid-cols-[52px_repeat(7,minmax(0,1fr))]")}
    >
      {/* The hour column. */}
      <div className="flex min-w-0 flex-col">
        <span className="h-[22px]" />
        <div className="relative flex-1">
          {marks.map((hour) => (
            <span key={hour} className="absolute right-0 -translate-y-1/2 text-xs whitespace-nowrap text-[var(--muted)]" style={{ top: pct(hour * 60) }}>{hourLabel(hour)}</span>
          ))}
        </div>
      </div>

      {GRID_ORDER.map((weekday) => {
        const day = shown(weekday);
        const ghost = campaignMode ? week[weekday] : null;
        const switchedOff = offBySwitch(weekday);
        const off = campaignMode ? !ghost || switchedOff || day === null : day === null || switchedOff;
        const cut = !campaignMode && !switchedOff && rule ? stateCut(day, rule, weekday) : null;
        const dragging = drag?.weekday === weekday || (campaignMode && drag !== null);
        const name = WEEKDAYS[weekday];
        const canDraw = editable && !campaignMode && day === null && !switchedOff;
        return (
          <div key={weekday} className="flex min-w-0 flex-col">
            {editable && !campaignMode ? (
              <DropdownMenu open={menu === weekday} onOpenChange={(open) => setMenu(open ? weekday : null)}>
                <DropdownMenuTrigger className={cn("h-[22px] rounded-sm text-center text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]", off ? "text-[var(--muted)]" : "text-[var(--ink)]")} aria-label={`${name}: options`}>
                  {WEEKDAY_SHORT[weekday]}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {!off && day && <DropdownMenuItem onSelect={() => onCopy?.(weekday)}>Copy {name} to the whole week</DropdownMenuItem>}
                  {!switchedOff && (day ? (
                    <DropdownMenuItem onSelect={() => onDay?.(weekday, null)}>Make {name} a day off</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => onDay?.(weekday, { start: 9 * 60, end: 17 * 60 })}>Add hours to {name}</DropdownMenuItem>
                  ))}
                  {switchedOff && <DropdownMenuItem disabled>Off by the No Sundays switch</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <b className={cn("h-[22px] text-center text-xs font-semibold", off ? "text-[var(--muted)]" : "text-[var(--ink)]")}>{WEEKDAY_SHORT[weekday]}</b>
            )}
            <div
              data-day-column=""
              onContextMenu={editable && !campaignMode ? (event) => { event.preventDefault(); setMenu(weekday); } : undefined}
              onPointerDown={canDraw ? (event) => begin(event, weekday, "draw") : undefined}
              onPointerMove={drag?.edge === "draw" && drag.weekday === weekday ? move : undefined}
              onPointerUp={drag?.edge === "draw" && drag.weekday === weekday ? end : undefined}
              className={cn("relative flex-1 touch-none rounded-[10px] bg-[var(--canvas)] shadow-[inset_0_0_0_1px_var(--border)]", canDraw && "cursor-crosshair")}
              style={RULES}
            >
              {campaignMode && ghost && !switchedOff && (
                <div aria-hidden="true" className="absolute inset-x-1 rounded-[8px] shadow-[inset_0_0_0_1.5px_var(--border-strong)]" style={{ ...HATCH.ghost, top: pct(ghost.start), height: height(ghost) }} />
              )}
              {off ? (
                campaignMode && ghost && !switchedOff ? (
                  <div className="absolute inset-0 grid place-items-center text-center text-xs text-[var(--muted)]">Not this campaign</div>
                ) : (
                  <div className="absolute inset-0 grid place-items-center rounded-[10px] text-center text-xs text-[var(--muted)]" style={HATCH.off}>
                    <span>Off{switchedOff && !mini ? <><br />No Sundays</> : null}{canDraw && !mini ? <><br />Drag to add hours</> : null}</span>
                  </div>
                )
              ) : day ? (
                <>
                  <div
                    className={cn(
                      "absolute inset-x-1 rounded-[8px] bg-[var(--primary-soft)] px-1.5 py-1.5 text-xs leading-[1.3] font-semibold text-[var(--accent-ink)] shadow-[inset_0_0_0_1.5px_var(--primary)]",
                      dragging && "shadow-[inset_0_0_0_2px_var(--primary),0_0_0_4px_var(--primary-soft)]",
                    )}
                    style={{ top: pct(day.start), height: height(day) }}
                  >
                    {mini ? (
                      <span className="block truncate">{clock(day.start, true).replace(/ (am|pm)$/, "")}–{clock(day.end, true)}</span>
                    ) : (
                      <>
                        <span className="block truncate">{clock(day.start)}</span>
                        <small className="block truncate text-xs font-medium opacity-85">to {clock(day.end)}</small>
                      </>
                    )}
                    {editable && (["start", "end"] as const).map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        aria-label={`${name} ${edge === "start" ? "starts" : "ends"} ${clock(day[edge])}. Arrow keys move it 15 minutes.`}
                        onPointerDown={(event) => begin(event, weekday, edge)}
                        onPointerMove={move}
                        onPointerUp={end}
                        onPointerCancel={end}
                        onKeyDown={(event) => keyEdge(event, weekday, edge)}
                        className={cn(
                          "absolute left-1/2 h-3 w-10 -translate-x-1/2 cursor-ns-resize touch-none outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]",
                          edge === "start" ? "-top-1.5" : "-bottom-1.5",
                        )}
                      >
                        <span aria-hidden="true" className="mx-auto block h-1 w-[26px] rounded-full bg-[var(--primary)]" />
                      </button>
                    ))}
                  </div>
                  {draft && drag && drag.edge !== "draw" && drag.weekday === weekday && (
                    <span className="pointer-events-none absolute left-1/2 z-[3] -translate-x-1/2 rounded-md bg-[var(--ink)] px-2 py-1 text-xs font-semibold whitespace-nowrap text-[var(--surface)]" style={{ top: `calc(${pct(draft.day[drag.edge])} + ${drag.edge === "end" ? "8px" : "-30px"})` }}>
                      {drag.edge === "end" ? "Ends" : "Starts"} {clock(draft.day[drag.edge])}
                    </span>
                  )}
                  {cut?.closed && (
                    <div className="absolute inset-x-1 z-[1] overflow-hidden rounded-[6px] px-1.5 py-px text-xs font-semibold whitespace-nowrap text-[var(--warning-ink)] shadow-[inset_0_0_0_1px_var(--warning)]" style={{ ...HATCH.state, top: pct(day.start), height: height(day) }}>
                      {stateCode} bars this day
                    </div>
                  )}
                  {cut && !cut.closed && cut.before !== null && (
                    <div className="absolute inset-x-1 z-[1] overflow-hidden rounded-[6px] px-1.5 py-px text-xs font-semibold whitespace-nowrap text-[var(--warning-ink)] shadow-[inset_0_0_0_1px_var(--warning)]" style={{ ...HATCH.state, top: pct(day.start), height: height({ start: day.start, end: cut.before }) }}>
                      {stateCode} starts {clock(cut.before, true)}
                    </div>
                  )}
                  {cut && !cut.closed && cut.after !== null && (
                    <div className="absolute inset-x-1 z-[1] overflow-hidden rounded-[6px] px-1.5 py-px text-xs font-semibold whitespace-nowrap text-[var(--warning-ink)] shadow-[inset_0_0_0_1px_var(--warning)]" style={{ ...HATCH.state, top: pct(cut.after), height: height({ start: cut.after, end: day.end }) }}>
                      {stateCode} ends {clock(cut.after, true)}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The grid's key, as the board draws it. */
export function GridLegend({ items }: { items: Array<"call" | "state" | "off" | "agency" | "campaign"> }) {
  const swatch: Record<string, { label: string; className: string; style?: CSSProperties }> = {
    call: { label: "You call", className: "bg-[var(--primary-soft)] shadow-[inset_0_0_0_1.5px_var(--primary)]" },
    campaign: { label: "This campaign", className: "bg-[var(--primary-soft)] shadow-[inset_0_0_0_1.5px_var(--primary)]" },
    state: { label: "State stops earlier", className: "shadow-[inset_0_0_0_1px_var(--warning)]", style: HATCH.state },
    off: { label: "Day off", className: "shadow-[inset_0_0_0_1px_var(--border)]", style: HATCH.off },
    agency: { label: "Agency hours", className: "shadow-[inset_0_0_0_1px_var(--border-strong)]", style: HATCH.ghost },
  };
  return (
    <span className="flex items-center gap-3.5 text-xs whitespace-nowrap text-[var(--muted)]">
      {items.map((item) => (
        <span key={item} className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className={cn("inline-block h-2.5 w-3.5 rounded-[3px]", swatch[item].className)} style={swatch[item].style} />
          {swatch[item].label}
        </span>
      ))}
    </span>
  );
}
