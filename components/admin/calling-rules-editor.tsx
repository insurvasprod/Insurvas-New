"use client";

import { useMemo, useState } from "react";

import { Callout, Field, Pill, control, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { US_STATES } from "@/lib/appointments/constants";
import {
  FEDERAL_END,
  FEDERAL_START,
  WEEKDAYS,
  boardSummary,
  buildStateBoard,
  daysLabel,
  hoursLabel,
  publishRuleSchema,
  type CallingHoliday,
  type CallingRulesBoard,
  type StateBoardRow,
  type StateRuleVersion,
} from "@/lib/callingWindow/rulesModel";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * /admin/calling-rules · the state calling rules the dialer enforces on top of the federal window.
 *
 * Every state, what applies to it today and what is scheduled, which states have no rule of their
 * own yet, and the holiday calendar. A rule is never edited in place: a new version is published
 * from a date and the old one closes on it, so the table is the record of what applied when. The
 * platform enters no legal data itself; every row names the statute it came from.
 */

const STATE_NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
const stateName = (code: string) => STATE_NAMES.get(code) ?? code;
const PAGE_SIZE = 15;

type StateFilter = "all" | "no_rule" | "has_rule" | "scheduled";
type HolidayScope = "upcoming" | "all";

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function send(url: string, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "The change did not save.");
  return json;
}

export function CallingRulesEditor({ board: initial, today }: { board: CallingRulesBoard; today: string }) {
  const [board, setBoard] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StateFilter>("all");
  const [page, setPage] = useState(1);
  const [holidayQuery, setHolidayQuery] = useState("");
  const [holidayScope, setHolidayScope] = useState<HolidayScope>("upcoming");
  const [holidayPage, setHolidayPage] = useState(1);
  const [openState, setOpenState] = useState<string | null>(null);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows = useMemo(() => buildStateBoard(board.states, board.versions, today), [board, today]);
  const summary = boardSummary(rows, board.holidays, today);
  const readOnly = !board.schemaReady;

  async function reload() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/calling-rules", { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error ?? "Could not load the calling rules");
      setBoard(json as CallingRulesBoard);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the calling rules");
    } finally {
      setRefreshing(false);
    }
  }

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await run();
      notify.done(done);
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (filter === "no_rule" && row.hasStateRule) return false;
    if (filter === "has_rule" && !row.hasStateRule) return false;
    if (filter === "scheduled" && row.scheduled.length === 0) return false;
    return !needle || row.state.toLowerCase().includes(needle) || stateName(row.state).toLowerCase().includes(needle);
  });
  const statePage = paginate(shown, page, PAGE_SIZE);

  const holidayNeedle = holidayQuery.trim().toLowerCase();
  const holidays = board.holidays
    .filter((h) => holidayScope === "all" || h.date >= today)
    .filter((h) => !holidayNeedle || h.name.toLowerCase().includes(holidayNeedle) || (h.state ?? "every state").toLowerCase().includes(holidayNeedle))
    .sort((a, b) => a.date.localeCompare(b.date));
  const holidayRows = paginate(holidays, holidayPage, PAGE_SIZE);

  const reviewed = board.feed ? new Date(board.feed.lastRefreshedAt) : null;
  const reviewedLabel = reviewed && !Number.isNaN(reviewed.getTime()) ? dayLabel(board.feed!.lastRefreshedAt.slice(0, 10)) : "Never";
  const selected = openState ? rows.find((row) => row.state === openState) ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calling rules"
        description="State calling hours, Sunday rules and holidays the dialer applies on top of the federal 8:00 am – 9:00 pm."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            title="Confirm the rules as they stand. The dialer refuses every call once the last review is older than its limit."
            onClick={() => void act(() => send("/api/admin/calling-rules/reviewed", "POST"), "Review recorded. The rules feed is refreshed.")}
          >
            Mark reviewed
          </Button>
        }
      />

      <StatStrip label="State calling rules">
        <StatTile label="States with a rule" value={summary.withRule} footnote={`of ${summary.states}`} />
        <StatTile label="No state rule" value={summary.withoutRule} valueTone={summary.withoutRule > 0 ? "warning" : undefined} footnote="federal window only" />
        <StatTile label="Scheduled changes" value={summary.scheduled} footnote={summary.scheduled === 1 ? "version" : "versions"} />
        <StatTile label="Upcoming holidays" value={summary.upcomingHolidays} footnote="no calls" />
        <StatTile label="Last reviewed" value={reviewedLabel} valueSize="text" footnote={board.feed ? `stale after ${board.feed.staleAfterDays} days` : "not recorded"} />
      </StatStrip>

      {error && <Callout tone="error" title={error} />}
      {readOnly && <Callout tone="warning" title="Editing needs a database update that has not been applied yet. The rules below are read-only." />}
      {board.feed?.stale && <Callout tone="error" title="The rules feed is stale, so every dial is refused. Review the rules and mark them reviewed." />}

      <TableCard
        title="State rules"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void reload()} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search states" />
            <select
              aria-label="Show"
              className={toolbarControl}
              value={filter}
              onChange={(event) => { setFilter(event.target.value as StateFilter); setPage(1); }}
            >
              <option value="all">All states</option>
              <option value="no_rule">No state rule</option>
              <option value="has_rule">Has a state rule</option>
              <option value="scheduled">Change scheduled</option>
            </select>
          </DataToolbar>
        }
        footer={<Pager page={statePage.current} total={shown.length} noun="states" pageSize={PAGE_SIZE} onPage={setPage} />}
      >
        {shown.length === 0 ? (
          <NoMatches noun="states" onClear={() => { setQuery(""); setFilter("all"); }} />
        ) : (
          <div className="overflow-x-auto">
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[190px]")}>State</th>
                  <th scope="col" className={st.th}>Hours</th>
                  <th scope="col" className={st.th}>Days</th>
                  <th scope="col" className={st.th}>Sunday</th>
                  <th scope="col" className={st.th}>Holidays</th>
                  <th scope="col" className={st.th}>In force since</th>
                  <th scope="col" className={st.th}>Source</th>
                  <th scope="col" className={cn(st.th, st.num)}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {statePage.rows.map((row) => (
                  <StateRow key={row.state} row={row} onOpen={() => setOpenState(row.state)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <TableCard
        title="Holidays"
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" disabled={busy || readOnly} onClick={() => setAddingHoliday(true)}>Add a holiday</Button>
                <RefreshButton onClick={() => void reload()} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={holidayQuery} onChange={(value) => { setHolidayQuery(value); setHolidayPage(1); }} placeholder="Search holidays" />
            <select
              aria-label="Which dates"
              className={toolbarControl}
              value={holidayScope}
              onChange={(event) => { setHolidayScope(event.target.value as HolidayScope); setHolidayPage(1); }}
            >
              <option value="upcoming">Upcoming</option>
              <option value="all">All dates</option>
            </select>
          </DataToolbar>
        }
        footer={<Pager page={holidayRows.current} total={holidays.length} noun="holidays" pageSize={PAGE_SIZE} onPage={setHolidayPage} />}
      >
        {holidays.length === 0 ? (
          <NoMatches noun="holidays" onClear={() => { setHolidayQuery(""); setHolidayScope("all"); }} />
        ) : (
          <div className="overflow-x-auto">
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[150px]")}>Date</th>
                  <th scope="col" className={st.th}>Holiday</th>
                  <th scope="col" className={st.th}>Applies to</th>
                  <th scope="col" className={st.th}>Source</th>
                  <th scope="col" className={cn(st.th, st.num)}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {holidayRows.rows.map((holiday) => (
                  <HolidayRow
                    key={holiday.id}
                    holiday={holiday}
                    removable={!readOnly && holiday.date >= today}
                    disabled={busy}
                    onRemove={() => {
                      if (!window.confirm(`Remove ${holiday.name} on ${dayLabel(holiday.date)}? Calls will be allowed that day again.`)) return;
                      void act(() => send(`/api/admin/calling-rules/holidays/${holiday.id}`, "DELETE"), "Holiday removed.");
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {selected && (
        <StateRuleDialog
          row={selected}
          versions={board.versions.filter((version) => version.state === selected.state)}
          today={today}
          readOnly={readOnly}
          busy={busy}
          onClose={() => setOpenState(null)}
          onPublish={(input) => act(() => send("/api/admin/calling-rules", "POST", input), `${stateName(selected.state)} rule published.`)}
          onWithdraw={(version) => {
            if (!window.confirm(`Withdraw the ${stateName(version.state)} rule starting ${dayLabel(version.effectiveFrom)}?`)) return;
            void act(() => send(`/api/admin/calling-rules/${version.id}`, "DELETE"), "Scheduled rule withdrawn.");
          }}
        />
      )}
      {addingHoliday && (
        <HolidayDialog
          states={rows.map((row) => row.state)}
          today={today}
          busy={busy}
          onClose={() => setAddingHoliday(false)}
          onAdd={(input) => act(() => send("/api/admin/calling-rules/holidays", "POST", input), "Holiday added.")}
        />
      )}
    </div>
  );
}

function StateRow({ row, onOpen }: { row: StateBoardRow; onOpen: () => void }) {
  const rule = row.inForce;
  const next = row.scheduled[0];
  return (
    <tr>
      <td className={st.td}>
        <span className={st.strong}>{stateName(row.state)}</span>
        <span className={st.sub}>{row.state}{row.timezone ? ` · ${row.timezone}` : ""}</span>
        {!row.hasStateRule && <Pill tone="warning" className="mt-1">No state rule</Pill>}
      </td>
      <td className={st.td}>{rule ? hoursLabel(rule.startLocal, rule.endLocal) : hoursLabel(FEDERAL_START, FEDERAL_END)}</td>
      <td className={st.td}>{rule ? daysLabel(rule.allowedWeekdays) : "Every day"}</td>
      <td className={st.td}>
        {rule && !rule.allowedWeekdays.includes(0) ? "No calls" : rule?.sundayStartLocal ? hoursLabel(rule.sundayStartLocal, rule.sundayEndLocal) : "Same hours"}
      </td>
      <td className={st.td}>{rule?.blockHolidays ? "No calls" : "Allowed"}</td>
      <td className={st.td}>
        {rule ? dayLabel(rule.effectiveFrom) : "—"}
        {next && <span className={st.sub}>Changes {dayLabel(next.effectiveFrom)}</span>}
      </td>
      <td className={cn(st.td, "max-w-[260px]")}>
        <span className="line-clamp-2 text-[13px]">{rule ? rule.source : "Federal window"}</span>
      </td>
      <td className={cn(st.td, st.num)}>
        <Button type="button" variant="outline" size="sm" aria-label={`Open the ${stateName(row.state)} rule`} onClick={onOpen}>
          Open
        </Button>
      </td>
    </tr>
  );
}

function HolidayRow({ holiday, removable, disabled, onRemove }: { holiday: CallingHoliday; removable: boolean; disabled: boolean; onRemove: () => void }) {
  return (
    <tr>
      <td className={cn(st.td, "tabular-nums")}>{dayLabel(holiday.date)}</td>
      <td className={st.td}>
        {holiday.name}
        {!holiday.blocked && <Pill className="ml-2">Not blocking</Pill>}
      </td>
      <td className={st.td}>{holiday.state ? stateName(holiday.state) : "Every state"}</td>
      <td className={cn(st.td, "text-[13px]")}>{holiday.source ?? "—"}</td>
      <td className={cn(st.td, st.num)}>
        {removable && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Remove ${holiday.name}`} onClick={onRemove}>
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}

type Draft = {
  effectiveFrom: string;
  startLocal: string;
  endLocal: string;
  allowedWeekdays: number[];
  sundayHours: boolean;
  sundayStartLocal: string;
  sundayEndLocal: string;
  blockHolidays: boolean;
  source: string;
  notes: string;
};

function draftFrom(rule: StateRuleVersion | null, today: string): Draft {
  return {
    effectiveFrom: today,
    startLocal: rule?.startLocal ?? FEDERAL_START,
    endLocal: rule?.endLocal ?? FEDERAL_END,
    allowedWeekdays: rule?.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
    sundayHours: Boolean(rule?.sundayStartLocal),
    sundayStartLocal: rule?.sundayStartLocal ?? "12:00",
    sundayEndLocal: rule?.sundayEndLocal ?? FEDERAL_END,
    blockHolidays: rule?.blockHolidays ?? true,
    // The source is the reviewer's to give for every version: never carried over.
    source: "",
    notes: "",
  };
}

function StateRuleDialog({
  row,
  versions,
  today,
  readOnly,
  busy,
  onClose,
  onPublish,
  onWithdraw,
}: {
  row: StateBoardRow;
  versions: StateRuleVersion[];
  today: string;
  readOnly: boolean;
  busy: boolean;
  onClose: () => void;
  onPublish: (input: unknown) => Promise<boolean>;
  onWithdraw: (version: StateRuleVersion) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(row.inForce, today));
  const payload = {
    state: row.state,
    effectiveFrom: draft.effectiveFrom,
    startLocal: draft.startLocal,
    endLocal: draft.endLocal,
    allowedWeekdays: draft.allowedWeekdays,
    sundayStartLocal: draft.sundayHours && draft.allowedWeekdays.includes(0) ? draft.sundayStartLocal : null,
    sundayEndLocal: draft.sundayHours && draft.allowedWeekdays.includes(0) ? draft.sundayEndLocal : null,
    blockHolidays: draft.blockHolidays,
    source: draft.source,
    notes: draft.notes.trim() || null,
  };
  const check = publishRuleSchema.safeParse(payload);
  const problem = check.success ? (draft.effectiveFrom < today ? "A rule cannot take effect in the past." : null) : check.error.issues[0]?.message ?? "Check the rule";
  const history = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const toggleDay = (day: number) =>
    setDraft((current) => ({
      ...current,
      allowedWeekdays: current.allowedWeekdays.includes(day) ? current.allowedWeekdays.filter((d) => d !== day) : [...current.allowedWeekdays, day].sort(),
    }));

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">{stateName(row.state)} calling rule</DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            {row.hasStateRule ? "Publish a new version from a date. The version before it ends that day." : "No state rule yet: the federal window applies here."}
          </DialogDescription>
        </DialogHeader>

        {history.length > 0 && (
          <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>From</th>
                  <th scope="col" className={st.th}>Until</th>
                  <th scope="col" className={st.th}>Hours</th>
                  <th scope="col" className={st.th}>Days</th>
                  <th scope="col" className={st.th}>Source</th>
                  <th scope="col" className={cn(st.th, st.num)}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {history.map((version) => {
                  const inForce = row.inForce?.id === version.id;
                  const scheduled = version.effectiveFrom > today;
                  return (
                    <tr key={version.id}>
                      <td className={cn(st.td, "tabular-nums")}>
                        {dayLabel(version.effectiveFrom)}
                        {inForce && <Pill tone="success" className="ml-2">In force</Pill>}
                        {scheduled && <Pill tone="info" className="ml-2">Scheduled</Pill>}
                      </td>
                      <td className={cn(st.td, "tabular-nums")}>{version.effectiveTo ? dayLabel(version.effectiveTo) : "—"}</td>
                      <td className={st.td}>
                        {hoursLabel(version.startLocal, version.endLocal)}
                        {version.sundayStartLocal && <span className={st.sub}>Sunday {hoursLabel(version.sundayStartLocal, version.sundayEndLocal)}</span>}
                      </td>
                      <td className={st.td}>{daysLabel(version.allowedWeekdays)}{version.blockHolidays ? " · no holidays" : ""}</td>
                      <td className={cn(st.td, "text-[13px]")}>{version.source}</td>
                      <td className={cn(st.td, st.num)}>
                        {scheduled && !readOnly && (
                          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onWithdraw(version)}>
                            Withdraw
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Takes effect" htmlFor="rule-from" required>
            <input id="rule-from" type="date" min={today} className={control} value={draft.effectiveFrom} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} />
          </Field>
          <Field label="Earliest call" htmlFor="rule-start" required>
            <input id="rule-start" type="time" min={FEDERAL_START} max={FEDERAL_END} step={60} className={control} value={draft.startLocal} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, startLocal: event.target.value })} />
          </Field>
          <Field label="Latest call" htmlFor="rule-end" required hint="Calls stop at this time.">
            <input id="rule-end" type="time" min={FEDERAL_START} max={FEDERAL_END} step={60} className={control} value={draft.endLocal} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, endLocal: event.target.value })} />
          </Field>
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Days calls are allowed</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((label, day) => (
              <label key={label} className="inline-flex items-center gap-1.5 text-[14px] text-[var(--body)]">
                <input type="checkbox" checked={draft.allowedWeekdays.includes(day)} disabled={readOnly || busy} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {draft.allowedWeekdays.includes(0) && (
          <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
            <label className="inline-flex items-center gap-2 pb-2 text-[14px] text-[var(--body)]">
              <input type="checkbox" checked={draft.sundayHours} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, sundayHours: event.target.checked })} />
              Different hours on Sunday
            </label>
            {draft.sundayHours && (
              <>
                <Field label="Sunday earliest" htmlFor="rule-sun-start">
                  <input id="rule-sun-start" type="time" step={60} className={control} value={draft.sundayStartLocal} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, sundayStartLocal: event.target.value })} />
                </Field>
                <Field label="Sunday latest" htmlFor="rule-sun-end">
                  <input id="rule-sun-end" type="time" step={60} className={control} value={draft.sundayEndLocal} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, sundayEndLocal: event.target.value })} />
                </Field>
              </>
            )}
          </div>
        )}

        <label className="inline-flex items-center gap-2 text-[14px] text-[var(--body)]">
          <input type="checkbox" checked={draft.blockHolidays} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, blockHolidays: event.target.checked })} />
          No calls on this state&rsquo;s holidays or federal holidays
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Statute or source" htmlFor="rule-source" required hint="Cite the law this version comes from.">
            <input id="rule-source" className={control} value={draft.source} maxLength={300} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, source: event.target.value })} />
          </Field>
          <Field label="Notes" htmlFor="rule-notes">
            <input id="rule-notes" className={control} value={draft.notes} maxLength={1000} disabled={readOnly || busy} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </Field>
        </div>

        {problem && draft.source.trim() !== "" && <p role="alert" className="m-0 text-[13px] text-[var(--error-ink)]">{problem}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close</Button>
          <Button
            type="button"
            disabled={readOnly || busy || problem !== null}
            onClick={() => void onPublish(payload).then((saved) => { if (saved) onClose(); })}
          >
            {busy ? "Publishing…" : "Publish version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HolidayDialog({
  states,
  today,
  busy,
  onClose,
  onAdd,
}: {
  states: string[];
  today: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (input: unknown) => Promise<boolean>;
}) {
  const [state, setState] = useState("");
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const invalid = name.trim().length < 2 || !date || date < today;
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em]">Add a holiday</DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            No calls that day in a state whose rule bars holidays.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Applies to" htmlFor="holiday-state">
            <select id="holiday-state" className={control} value={state} disabled={busy} onChange={(event) => setState(event.target.value)}>
              <option value="">Every state (federal)</option>
              {states.map((code) => (
                <option key={code} value={code}>{stateName(code)}</option>
              ))}
            </select>
          </Field>
          <Field label="Date" htmlFor="holiday-date" required>
            <input id="holiday-date" type="date" min={today} className={control} value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Holiday" htmlFor="holiday-name" required>
            <input id="holiday-name" className={control} value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Source" htmlFor="holiday-source">
            <input id="holiday-source" className={control} value={source} maxLength={300} disabled={busy} onChange={(event) => setSource(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={busy || invalid}
            onClick={() => void onAdd({ state: state || null, date, name: name.trim(), source: source.trim() || null }).then((saved) => { if (saved) onClose(); })}
          >
            Add holiday
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
