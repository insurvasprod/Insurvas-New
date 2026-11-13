"use client";

/**
 * Settings › Calling windows (round 8) — Days off (board screen 4): the No federal holidays switch with
 * each date it blocks, and the agency's own days off under them (a closed day, or an afternoon). It
 * edits the page's draft: everything here saves with your hours.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { Switch, control } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { FEDERAL_MINUTES } from "@/lib/callingWindow/engine";
import { clock, longDate, type DayOff } from "@/lib/callingWindows/week";
import { cn } from "@/lib/utils";

const SHOWN = 6;
const FROM_TIMES = Array.from({ length: (FEDERAL_MINUTES.end - FEDERAL_MINUTES.start) / 15 }, (_, index) => FEDERAL_MINUTES.start + 15 + index * 15).filter((minute) => minute < FEDERAL_MINUTES.end);

export function DaysOffSheet({
  noFederalHolidays,
  onNoFederalHolidays,
  holidays,
  lawKeepsHolidays,
  daysOff,
  onDaysOff,
  ready,
  editable,
  switchesReady,
  today,
  onClose,
}: {
  noFederalHolidays: boolean;
  onNoFederalHolidays: (next: boolean) => void;
  /** Upcoming federal holidays, or null when the calendar could not be read. */
  holidays: { date: string; name: string }[] | null;
  /** Every state's own rule already bars the federal holidays, so none can be called one by one. */
  lawKeepsHolidays: boolean;
  daysOff: DayOff[];
  onDaysOff: (next: DayOff[]) => void;
  /** 20261112300000 applied: own days off can be stored. */
  ready: boolean;
  editable: boolean;
  /** 20260924121000 applied: the switch can be saved. */
  switchesReady: boolean;
  today: string;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState("");
  const [from, setFrom] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [problem, setProblem] = useState("");
  const list = holidays ?? [];
  const shown = all ? list : list.slice(0, SHOWN);
  const rest = list.slice(SHOWN);
  const blocked = noFederalHolidays || lawKeepsHolidays ? list.length : 0;

  function add() {
    if (!date || date < today) { setProblem("Pick a date from today on."); return; }
    if (daysOff.some((day) => day.date === date)) { setProblem("That date is already a day off."); return; }
    onDaysOff([...daysOff, { date, fromMinute: from, label: label.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setAdding(false);
    setDate("");
    setFrom(null);
    setLabel("");
    setProblem("");
  }

  return (
    <Sheet
      title="Days off"
      status={<StatusChip>{blocked + daysOff.length} {blocked + daysOff.length === 1 ? "day" : "days"}</StatusChip>}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-[var(--muted)]">Saves with your hours</span>
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <Switch id="days-off-federal" checked={noFederalHolidays} disabled={!editable || !switchesReady} onChange={onNoFederalHolidays} />
        <label htmlFor="days-off-federal" className="min-w-0">
          <b className="block text-sm font-medium text-[var(--ink)]">No federal holidays</b>
          <small className="block text-xs text-[var(--muted)]">
            {switchesReady ? "Nothing dials on these days, in any state" : "The switch can be saved once a pending database update is applied"}
          </small>
        </label>
      </div>

      <div>
        <h5 className="m-0 mb-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          Federal holidays · next 12 months <span className="rounded-[5px] bg-[var(--surface-alt)] px-1.5 font-medium">{list.length}</span>
        </h5>
        {holidays === null ? (
          <p className="m-0 py-2 text-xs text-[var(--muted)]">The holiday calendar could not be read here; the dialer still checks it.</p>
        ) : list.length === 0 ? (
          <p className="m-0 py-2 text-xs text-[var(--muted)]">No upcoming federal holidays are listed.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {shown.map((holiday) => (
              <li key={holiday.date} className="flex items-center gap-3 border-b border-border py-2.5">
                <div className="min-w-0">
                  <b className="block text-sm font-medium text-[var(--ink)]">{holiday.name}</b>
                  <small className="block text-xs text-[var(--muted)]">{longDate(holiday.date)}</small>
                </div>
                <span className="ml-auto" title={lawKeepsHolidays ? "State law keeps this day off in every state" : noFederalHolidays ? "Off by the switch" : "Called"}>
                  <CheckBox checked={noFederalHolidays || lawKeepsHolidays} disabled readOnly aria-label={`${holiday.name}: ${noFederalHolidays || lawKeepsHolidays ? "no calls" : "called"}`} />
                </span>
              </li>
            ))}
            {!all && rest.length > 0 && (
              <li className="py-2.5">
                <button type="button" className="text-left text-xs text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => setAll(true)}>
                  + {rest.length} more · {rest.map((holiday) => holiday.name).join(", ")}
                </button>
              </li>
            )}
          </ul>
        )}
        {lawKeepsHolidays && list.length > 0 && (
          <p className="m-0 mt-2 text-xs text-[var(--muted)]">State law already keeps these days off in every state you call, so a holiday can&rsquo;t be called one by one.</p>
        )}
      </div>

      <div>
        <h5 className="m-0 mb-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          Your own days off
          {!ready && <StatusChip tone="warning" dot={false}>Needs a database update</StatusChip>}
        </h5>
        {daysOff.length === 0 && <p className="m-0 py-2 text-xs text-[var(--muted)]">None yet. Close a day, or stop early on one, for the whole agency.</p>}
        <ul className="m-0 list-none p-0">
          {daysOff.map((day) => (
            <li key={day.date} className="flex items-center gap-3 border-b border-border py-2.5">
              <div className="min-w-0">
                <b className="block truncate text-sm font-medium text-[var(--ink)]">{day.label || (day.fromMinute == null ? "Closed" : "Closes early")}</b>
                <small className="block text-xs text-[var(--muted)]">{longDate(day.date)}{day.fromMinute == null ? " · all day" : ` · from ${clock(day.fromMinute, true)}`}</small>
              </div>
              {editable && <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onDaysOff(daysOff.filter((other) => other.date !== day.date))}>Remove</Button>}
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-border p-3">
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
                Date
                <input type="date" className={cn(control, "mt-0")} min={today} value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
                Closed
                <select className={cn(control, "mt-0")} value={from == null ? "" : String(from)} onChange={(event) => setFrom(event.target.value === "" ? null : Number(event.target.value))}>
                  <option value="">All day</option>
                  {FROM_TIMES.map((minute) => <option key={minute} value={minute}>From {clock(minute)}</option>)}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
              Name
              <input className={cn(control, "mt-0")} maxLength={80} placeholder="Christmas Eve, afternoon" value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            {problem && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{problem}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setProblem(""); }}>Cancel</Button>
              <Button type="button" size="sm" disabled={!date} onClick={add}>Add day off</Button>
            </div>
          </div>
        ) : (
          editable && (
            <Button type="button" variant="outline" size="sm" className="mt-2.5" disabled={!ready} title={ready ? undefined : "Needs a database update"} onClick={() => setAdding(true)}>
              + Add a day off
            </Button>
          )
        )}
      </div>
    </Sheet>
  );
}
