"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { SWITCH_FRAME, switchOption } from "@/components/ui/view-tabs";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { REVIEW_LABEL, ResetToDefault } from "@/components/app/settings/defaults";
import { CampaignSheet } from "@/components/app/settings/calling/campaign-sheet";
import { DaysOffSheet } from "@/components/app/settings/calling/days-off-sheet";
import { BoardCard, CardFoot, SaveBand, StatusLine, type StatusTone } from "@/components/app/settings/calling/parts";
import { StateRulesCard, StateRulesSheet, stateName as stateLabel } from "@/components/app/settings/calling/state-rules";
import { GridLegend, WeekGrid } from "@/components/app/settings/calling/week-grid";
import {
  INSURVAS_DEFAULT_WINDOW,
  campaignMinutes,
  effectiveMinutes,
  minuteLabel,
  statesToList,
  toMinutes,
  type CallingWindowOptions,
  type CallingWindowSettings,
  type CampaignWindow,
  type MinuteWindow,
} from "@/lib/callingWindow/engine";
import {
  dayProblem,
  daysLabel,
  envelope,
  fitsWithoutDays,
  longDate,
  openDays,
  rangeLabel,
  ruleLine,
  weekChanges,
  weekCut,
  weekFrom,
  type DayOff,
  type Week,
} from "@/lib/callingWindows/week";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * LA-2.4 · Calling windows — round 8 "the week you call" (owner: "Build all four", 2026-11-12).
 *
 * The agency's hours are blocks on a week grid you drag (quarter hours); a picked state's cut-offs are
 * drawn on it; "State rules in force" and "Campaigns that call less" sit beside it. No Sundays and
 * No federal holidays are switches in the card's header, the holiday list and the agency's own days off
 * open as a sheet, and a campaign opens as a right sheet that saves itself. The hours, the switches and
 * the days off are one draft with one save band; problems and pending database updates go in the status
 * line, never a notice card.
 *
 * Storage: the base window (tenant_calling_windows, the envelope of the open days), a row per weekday
 * that differs and the agency's own days off (20261112300000, lib/callingWindows/store.ts). Until that
 * is applied every open day keeps the same hours and the status line says so.
 */

type WeekPayload = { ready: boolean; week: Week; daysOff: DayOff[] } | null;
type Loaded = CallingWindowSettings & { canEdit: boolean; week?: WeekPayload };
type Draft = { week: Week; options: CallingWindowOptions; daysOff: DayOff[] };

const today = () => new Date().toISOString().slice(0, 10);

function baseOf(loaded: CallingWindowSettings): MinuteWindow | null {
  return loaded.tenant ? toMinutes(loaded.tenant) : null;
}

function draftFrom(loaded: Loaded): Draft {
  return {
    week: loaded.week?.week ?? weekFrom(baseOf(loaded), []),
    options: { ...loaded.options },
    daysOff: loaded.week?.daysOff ?? [],
  };
}

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function CallingWindowSettingsPanel() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: "campaign"; campaign: CampaignWindow | null } | { kind: "days-off" } | { kind: "rules" } | null>(null);

  // A promise chain: every setState lands in a callback (react-hooks/set-state-in-effect).
  const load = useCallback(
    () =>
      fetch("/api/app/calling-windows", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Could not load your calling windows");
          return body as Loaded;
        })
        .then((body) => {
          setError(null);
          setLoaded(body);
          setDraft(draftFrom(body));
          setNotice("");
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load your calling windows")),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const baseline = useMemo(() => (loaded ? draftFrom(loaded) : null), [loaded]);
  const dirty = Boolean(draft && baseline && !same(draft, baseline));

  // The states listed beside the grid: the ones the agency works in, else the ones whose rule bites.
  const listing = useMemo(() => {
    if (!loaded) return { rules: [], basis: "notable" as const, everyStateBansHolidays: false };
    const base = baseOf(loaded);
    const everyStateBansHolidays = loaded.stateRules.length > 0 && loaded.stateRules.every((rule) => rule.noHolidays);
    const without = effectiveMinutes(undefined, base, null);
    const { rules, basis } = statesToList(loaded.stateRules, loaded.dialingStates, (rule) => {
      const effective = effectiveMinutes(rule, base, null);
      return effective.start !== without.start || effective.end !== without.end || rule.noSunday || (rule.noHolidays && !everyStateBansHolidays);
    });
    return { rules, basis, everyStateBansHolidays };
  }, [loaded]);

  async function put(body: Record<string, unknown>): Promise<Loaded> {
    const response = await fetch("/api/app/calling-windows", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "Could not save the calling window");
    return { ...(result as Loaded), canEdit: loaded?.canEdit ?? false };
  }

  /** True when it saved; the leave guard keeps the owner on the page otherwise. */
  async function save(): Promise<boolean> {
    if (!draft || problem) return false;
    setBusy(true);
    setSaveError("");
    try {
      const next = await put({
        scope: "week",
        week: draft.week.map((day) => (day ? { startMinute: day.start, endMinute: day.end } : null)),
        options: draft.options,
        daysOff: draft.daysOff,
      });
      setLoaded(next);
      setDraft(draftFrom(next));
      notify.done("Calling hours saved");
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save your calling hours");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const frame = (body: ReactNode, status?: ReactNode) => (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader />
      {status}
      {body}
    </SettingsStack>
  );

  if (error)
    return frame(
      <div className={cn(cardSurface, "min-h-[260px]")}>
        <ErrorState title="Couldn't load your calling windows" detail={`${error}. The dialer keeps using the saved hours.`} action={<Button type="button" variant="outline" onClick={() => { setError(null); void load(); }}>Try again</Button>} />
      </div>,
    );
  if (!loaded || !draft || !baseline)
    return frame(
      <div className="flex min-h-[420px] flex-1 gap-3 max-lg:flex-col">
        <BoardCard title="Your agency's hours" className="flex-1">
          <div aria-busy="true" aria-label="Loading your calling windows" className="grid flex-1 grid-cols-7 items-start gap-2 p-4">
            {[120, 120, 120, 120, 110, 80, 40].map((size, index) => (
              <div key={index} className="animate-pulse rounded-md bg-[var(--surface-alt)]" style={{ height: size }} />
            ))}
          </div>
        </BoardCard>
      </div>,
    );

  const readOnly = !loaded.canEdit;
  const weekReady = loaded.week?.ready === true;
  const defaultLive = loaded.insurvasDefaultLive === true;
  const isDefault = loaded.tenantIsDefault === true && loaded.optionsAreDefault === true && baseline.daysOff.length === 0 && fitsWithoutDays(baseline.week, baseline.options.noSunday);
  const rule = state ? listing.rules.find((entry) => entry.state === state) : undefined;
  const problem = draft.week.map((day, weekday) => dayProblem(day, weekday)).find(Boolean) ?? (envelope(draft.week) ? null : "Open at least one day. To stop dialing altogether, pause your campaigns instead.");
  const changes = weekChanges(
    { week: baseline.week, ...baseline.options, daysOff: baseline.daysOff, allowed: [] },
    { week: draft.week, ...draft.options, daysOff: draft.daysOff, allowed: [] },
  );
  const holidays = loaded.federalHolidays;
  const lawKeepsHolidays = listing.everyStateBansHolidays && loaded.stateCheckReadsFederalHolidays === true;
  const holidayCount = holidays?.length ?? 0;
  const nextOff = [
    ...(draft.options.noFederalHolidays || lawKeepsHolidays ? (holidays ?? []).map((holiday) => ({ date: holiday.date, name: holiday.name })) : []),
    ...draft.daysOff.map((day) => ({ date: day.date, name: day.label || "Day off" })),
  ].filter((day) => day.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];

  /* ── editing the week ─────────────────────────────────────────────── */

  function setWeek(next: Week) {
    setDraft((current) => (current ? { ...current, week: next } : current));
    setNotice("");
  }

  function onDay(weekday: number, day: MinuteWindow | null) {
    if (!draft) return;
    if (!weekReady) {
      // Before 20261112300000 every open day has the same hours: a change to one is a change to all.
      if (day === null) { setNotice("A day off on its own needs a database update. Until then only Sunday can be off, with the No Sundays switch."); return; }
      setWeek(draft.week.map(() => ({ ...day })));
      if (weekday !== 1) setNotice("Every open day has the same hours until a database update is applied, so this changed the whole week.");
      return;
    }
    setWeek(draft.week.map((current, index) => (index === weekday ? day : current)));
  }

  function onCopy(weekday: number) {
    if (!draft) return;
    const day = draft.week[weekday];
    if (!day) return;
    setWeek(draft.week.map(() => ({ ...day })));
  }

  const setOptions = (patch: Partial<CallingWindowOptions>) => setDraft((current) => (current ? { ...current, options: { ...current.options, ...patch } } : current));

  /* ── the status line ──────────────────────────────────────────────── */

  const pending = [
    !weekReady ? "different hours per day and your own days off need a database update" : null,
    !loaded.schemaReady ? "minutes and the switches need a database update" : null,
  ].filter(Boolean);
  let tone: StatusTone = "good";
  let line: ReactNode[] = [];
  let action: ReactNode = null;
  if (saveError) {
    tone = "danger";
    line = [saveError];
    action = <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs text-[var(--error-ink)] underline" onClick={() => void save()}>Retry</Button>;
  } else if (problem) {
    tone = "danger";
    line = [problem];
  } else if (loaded.rulesFeed?.stale) {
    tone = "danger";
    line = ["State rules are out of date, so the dialer refuses every dial until they are refreshed"];
  } else if (dirty) {
    tone = "warning";
    line = [`${changes.length || 1} unsaved ${changes.length === 1 ? "change" : "changes"}`, ...changes.slice(0, 3)];
    if (notice) line.push(notice);
  } else if (readOnly) {
    tone = "warning";
    line = ["Only the owner can change calling windows. You're seeing what's in force"];
  } else {
    tone = pending.length || notice ? "warning" : "good";
    line = [
      isDefault ? "Saved · the Insurvas default" : "Saved",
      defaultLive ? REVIEW_LABEL : null,
      notice || null,
      nextOff ? `next day off: ${nextOff.name}, ${longDate(nextOff.date).replace(/, \d{4}$/, "")}` : null,
      ...pending,
      "every time is the customer's local time",
    ].filter((part): part is string => Boolean(part));
  }

  /* ── campaigns ────────────────────────────────────────────────────── */

  const narrowed = loaded.campaigns.filter((campaign) => campaignMinutes(campaign) !== null);
  const usingAgency = loaded.campaigns.length - narrowed.length;
  const open = openDays(draft.week, draft.options.noSunday);
  const agencyEnvelope = envelope(draft.week);

  const campaignHours = (campaign: CampaignWindow) => {
    const own = campaignMinutes(campaign);
    if (!own || !agencyEnvelope) return "Agency hours";
    const hours = { start: Math.max(agencyEnvelope.start, own.start ?? agencyEnvelope.start), end: Math.min(agencyEnvelope.end, own.end ?? agencyEnvelope.end) };
    return `${daysLabel(open)} ${rangeLabel(hours)}`;
  };

  /* ── the state picker over the grid ───────────────────────────────── */

  // The states whose rule cuts your week come first, in the list and in the picker.
  const cuts = new Map(listing.rules.map((entry) => [entry.state, weekCut(draft.week, draft.options.noSunday, entry)]));
  const sortedRules = [...listing.rules].sort((a, b) => (cuts.get(b.state) ?? 0) - (cuts.get(a.state) ?? 0) || (ruleLine(a) === "Federal hours" ? 1 : 0) - (ruleLine(b) === "Federal hours" ? 1 : 0) || a.state.localeCompare(b.state));
  const quick = sortedRules.slice(0, 4);
  const more = sortedRules.slice(4);

  const actions = (
    <>
      {!readOnly && defaultLive && !isDefault && (
        <ResetToDefault
          what="your agency's calling hours and switches"
          kept={`Back to ${minuteLabel(INSURVAS_DEFAULT_WINDOW.start)}–${minuteLabel(INSURVAS_DEFAULT_WINDOW.end)} every day, no Sundays, no federal holidays. Campaigns that call less and your own days off stay.`}
          label="Reset to Insurvas default"
          disabled={busy}
          onReset={async () => {
            try {
              const next = await put({ scope: "reset" });
              setLoaded(next);
              setDraft(draftFrom(next));
              notify.done("Calling windows are back on the Insurvas default");
              return true;
            } catch (cause) {
              setSaveError(cause instanceof Error ? cause.message : "Could not reset the calling window");
              return false;
            }
          }}
        />
      )}
      {!readOnly && !defaultLive && loaded.tenant && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            try {
              const next = await put({ scope: "tenant", window: null });
              setLoaded(next);
              setDraft(draftFrom(next));
              notify.done("Your own hours were cleared. Only the federal and state limits apply.");
            } catch (cause) {
              setSaveError(cause instanceof Error ? cause.message : "Could not clear your hours");
            }
          }}
        >
          Clear my hours
        </Button>
      )}
      <Button type="button" variant="outline" onClick={() => setSheet({ kind: "days-off" })}>Days off</Button>
    </>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader actions={actions} />
      <LeaveGuard dirty={dirty && !readOnly} onSave={() => save()} onDiscard={() => { setDraft(baseline); setNotice(""); }} what="your calling hours" />
      <StatusLine tone={tone} action={action}>{line.map((part, index) => <span key={index}>{index > 0 ? " · " : ""}{part}</span>)}</StatusLine>

      <div className="flex min-h-0 flex-1 gap-3 max-lg:flex-col lg:min-h-[600px]">
        <BoardCard
          label="Your agency's hours"
          title="Your agency's hours"
          className="flex-1"
          right={
            <>
              <span className="inline-flex items-center gap-2 text-sm text-[var(--body)]">
                <Switch id="calling-no-sunday" checked={draft.options.noSunday} disabled={readOnly || busy || !loaded.schemaReady} onChange={(next) => setOptions({ noSunday: next })} />
                <label htmlFor="calling-no-sunday">No Sundays</label>
              </span>
              <span className="ml-2.5 inline-flex items-center gap-2 text-sm text-[var(--body)]">
                <Switch id="calling-no-holidays" checked={draft.options.noFederalHolidays} disabled={readOnly || busy || !loaded.schemaReady} onChange={(next) => setOptions({ noFederalHolidays: next })} />
                <label htmlFor="calling-no-holidays">No federal holidays</label>
                {holidays !== null && (
                  <button type="button" className="text-xs font-medium text-[var(--accent-ink)] hover:underline" onClick={() => setSheet({ kind: "days-off" })}>
                    {holidayCount} {holidayCount === 1 ? "day" : "days"}
                  </button>
                )}
              </span>
            </>
          }
          footer={
            readOnly ? (
              <CardFoot>Read-only: what is in force today. Only the owner can change it.</CardFoot>
            ) : (
              <SaveBand
                count={dirty ? Math.max(1, changes.length) : 0}
                what={dirty ? "the dialer keeps the saved hours until you save" : undefined}
                idle="Drag the top or bottom edge of a day to change it · drag across an empty day to add hours · right-click a day to copy it to the whole week"
                saving={busy}
                onDiscard={() => { setDraft(baseline); setSaveError(""); setNotice(""); }}
                save={
                  <Button data-guide="calling-windows-save" type="button" size="sm" disabled={!dirty || busy || Boolean(problem)} onClick={() => void save()}>
                    {busy ? "Saving…" : "Save hours"}
                  </Button>
                }
              />
            )
          }
        >
          <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-1">
            <span className="text-xs whitespace-nowrap text-[var(--muted)]">Show a state on the grid</span>
            {listing.rules.length > 0 && (
              <div role="radiogroup" aria-label="Show a state on the grid" className={cn(SWITCH_FRAME, "max-w-full overflow-x-auto")}>
                {[{ key: null as string | null, label: "None" }, ...quick.map((entry) => ({ key: entry.state as string | null, label: stateLabel(entry.state) }))].map((option) => (
                  <button key={option.label} type="button" role="radio" aria-checked={state === option.key} onClick={() => setState(option.key)} className={switchOption(state === option.key, "h-8 shrink-0 px-2.5 text-xs font-medium")}>
                    {option.label}
                  </button>
                ))}
                {more.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className={switchOption(Boolean(state && more.some((entry) => entry.state === state)), "h-8 shrink-0 px-2.5 text-xs font-medium")}>
                      {state && more.some((entry) => entry.state === state) ? stateLabel(state) : `+${more.length}`}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                      {more.map((entry) => <DropdownMenuItem key={entry.state} onSelect={() => setState(entry.state)}>{stateLabel(entry.state)}</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
            <span className="ml-auto"><GridLegend items={["call", "state", "off"]} /></span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
            <WeekGrid
              week={draft.week}
              noSunday={draft.options.noSunday}
              editable={!readOnly && !busy}
              onDay={onDay}
              onCopy={onCopy}
              rule={rule}
              stateCode={rule?.state}
              label="Your agency's hours, Monday to Sunday"
            />
          </div>
        </BoardCard>

        <div className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-[400px]">
          <StateRulesCard
            rules={sortedRules}
            week={draft.week}
            noSunday={draft.options.noSunday}
            selected={state}
            onSelect={setState}
            onOpenAll={() => setSheet({ kind: "rules" })}
            available={loaded.stateRulesAvailable}
            onRetry={() => void load()}
          />
          <BoardCard
            label="Campaigns that call less"
            title="Campaigns that call less"
            className="flex-1"
            right={!readOnly && loaded.campaigns.length > 0 && narrowed.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSheet({ kind: "campaign", campaign: null })}><Plus aria-hidden="true" />Narrow a campaign</Button>
            ) : undefined}
            footer={
              <CardFoot>
                <span>A campaign can only call less than your agency, never more{loaded.campaigns.length ? ` · ${usingAgency} ${usingAgency === 1 ? "campaign uses" : "campaigns use"} your hours` : ""}</span>
                <span className="ml-auto inline-flex items-center gap-2">
                  <Switch id="calling-campaign-overrides" label="Campaigns may call less" checked={draft.options.campaignOverrides} disabled={readOnly || busy || !loaded.schemaReady} onChange={(next) => setOptions({ campaignOverrides: next })} />
                  <label htmlFor="calling-campaign-overrides" className="text-xs">{draft.options.campaignOverrides ? "On" : "Off, none apply"}</label>
                </span>
              </CardFoot>
            }
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loaded.campaigns.length === 0 ? (
                <EmptyState title="No campaigns yet" hint="Create a campaign to give it shorter calling times than your agency." />
              ) : narrowed.length === 0 ? (
                <EmptyState
                  title="Every campaign uses your hours"
                  hint="Narrow one when a vendor or carrier asks for shorter calling times."
                  action={!readOnly ? <Button type="button" variant="outline" onClick={() => setSheet({ kind: "campaign", campaign: null })}><Plus aria-hidden="true" />Narrow a campaign</Button> : undefined}
                />
              ) : (
                <ul className="m-0 list-none p-0">
                  {narrowed.map((campaign) => (
                    <li key={campaign.id}>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setSheet({ kind: "campaign", campaign })}
                        className={cn("flex w-full items-start gap-2.5 border-b border-border px-4 py-2 text-left hover:bg-[var(--surface-alt)] disabled:cursor-default", sheet?.kind === "campaign" && sheet.campaign?.id === campaign.id && "bg-[var(--surface-alt)]")}
                      >
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-sm font-semibold text-[var(--ink)]">{campaign.name}</b>
                          <small className="block truncate text-xs text-[var(--muted)]">{campaign.reason ?? "No reason given"}</small>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--body)]">{campaignHours(campaign)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </BoardCard>
        </div>
      </div>

      {sheet?.kind === "campaign" && (
        <CampaignSheet
          key={sheet.campaign?.id ?? "new"}
          campaign={sheet.campaign}
          campaigns={loaded.campaigns}
          week={draft.week}
          noSunday={draft.options.noSunday}
          schemaReady={loaded.schemaReady}
          rule={rule}
          onClose={() => setSheet(null)}
          onSave={async (campaignId, window, reason) => {
            const next = await put({ scope: "campaign", campaignId, window: window ? { startMinute: window.start, endMinute: window.end } : null, reason });
            // A campaign saves itself: the agency draft (if any) stays as it is.
            setLoaded((current) => (current ? { ...next, week: current.week } : next));
            notify.done(window ? "Campaign hours saved" : "That campaign uses your agency's hours again");
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === "days-off" && (
        <DaysOffSheet
          noFederalHolidays={draft.options.noFederalHolidays}
          onNoFederalHolidays={(next) => setOptions({ noFederalHolidays: next })}
          holidays={holidays}
          lawKeepsHolidays={lawKeepsHolidays}
          daysOff={draft.daysOff}
          onDaysOff={(next) => setDraft((current) => (current ? { ...current, daysOff: next } : current))}
          ready={weekReady}
          editable={!readOnly}
          switchesReady={loaded.schemaReady}
          today={today()}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "rules" && (
        <StateRulesSheet
          rules={listing.rules}
          base={baseOf(loaded)}
          everyStateBansHolidays={listing.everyStateBansHolidays}
          readsFederalHolidays={loaded.stateCheckReadsFederalHolidays === true}
          feed={loaded.rulesFeed ?? null}
          basis={listing.basis}
          onClose={() => setSheet(null)}
        />
      )}
    </SettingsStack>
  );
}

