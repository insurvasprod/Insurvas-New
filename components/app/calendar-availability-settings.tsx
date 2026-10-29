"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { notify } from "@/lib/notify";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { CalendarClock, CalendarSync, Layers } from "lucide-react";
import { DateTimePicker } from "@/components/app/settings/date-time-picker";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PagedBody, PagedPager, PagedProvider } from "@/components/ui/paged";
import { Callout, DashedCard, DraftActions, Field, PlusIcon, SettingsCard, SettingsSectionHeader, SettingsStack, SettingsTableCard, Switch, control, st } from "@/components/app/settings/primitives";
import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
import {
  BLOCK_REPEATS,
  REPEAT_LABELS,
  WEEKDAYS,
  blockWhen,
  minutesOf,
  slotsForDay,
  slotsLostPerWeek,
  type BlockRepeat,
} from "@/lib/appointments/calendarMath";
import {
  type CalendarConnectionView,
  type CalendarProviderView,
} from "@/lib/appointments/linkedCalendarsShared";
import { cn } from "@/lib/utils";
import { cardHead, glass } from "@/components/ui/card";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { ToggleChip } from "@/components/ui/toggle-chip";

/**
 * LA-2.11 · Calendar & availability.
 *
 * Every rule in `book_appointment` reads one of these three tables, and until this screen existed
 * nothing in the product wrote any of them — so the working-hours check, the blocked-time check and
 * the daily cap all skipped themselves, the roster was empty, and the dialer hid its booking card
 * because it derives its agent list from availability rows.
 *
 * The screen is deliberately plain about that: a member with no hours is shown as "No hours set"
 * with the consequence spelled out, rather than as an empty week that looks configured.
 *
 * The whole member's calendar is one draft: edits are held here, Save changes writes them and
 * Discard drops them. Each row's editor (a day's hours, a block) edits the draft, not the database.
 *
 * Layout (owner pick C, 2026-10-26, without its summary sentence): whose calendar, then five tabs —
 * Working hours (quick-start presets, a switch per day, hours inline), Appointments (length and gap as
 * chips, the member's daily limit), Time off & breaks, Booking rules, and Whole agency (owner-only limits).
 */

type Hour = { weekday: number; startTime: string; endTime: string };
type Block = { id?: string; startsAt: string; endsAt: string; reason: string | null; repeats: BlockRepeat };
type Policy = {
  appointmentMinutes: number;
  bufferMinutes: number;
  maxPerDay: number;
  allowSameDay: boolean;
  honourLinkedCalendars: boolean;
  allowDoubleBooking?: boolean;
};
type Member = { userId: string; name: string; role: string; timezone: string | null; hours: Hour[]; blocks: Block[]; policy: Policy };
type Payload = {
  members: Member[];
  canEditOthers: boolean;
  selfUserId: string;
  schema?: { settingsReady: boolean; bookingReady?: boolean };
  /** The agency-wide daily limit (20260924230200); null = no agency limit. */
  agency?: { maxPerDay: number | null; callbackReminderMinutes?: number | null };
  /** An agency plan (AG-0.1). A one-agent plan has no Whole agency tab. */
  isAgency?: boolean;
};
type Linked = { available: boolean; providers: CalendarProviderView[]; connections: CalendarConnectionView[] };

const CONNECT_OUTCOMES: Record<string, string> = {
  connected: "Calendar linked. Its busy time now removes slots.",
  declined: "The calendar was not linked: consent was declined.",
  failed: "The calendar could not be linked. Try again.",
  invalid: "That calendar link was incomplete. Start again.",
  wrong_workspace: "That calendar link was started in another workspace.",
  signed_out: "Sign in, then link the calendar again.",
};

/** Monday first, the way a working week is read. Values are `extract(dow)` numbers, 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The zones this product already reasons about, plus whatever the browser says the reader is in. */
const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "Asia/Manila", "Asia/Kolkata", "UTC",
];
/** Time zones in words, US first (settings audit: the list showed raw codes in an odd order). */
const ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern (New York)", "America/Chicago": "Central (Chicago)", "America/Denver": "Mountain (Denver)",
  "America/Los_Angeles": "Pacific (Los Angeles)", "America/Phoenix": "Arizona (Phoenix)", "America/Anchorage": "Alaska (Anchorage)",
  "Pacific/Honolulu": "Hawaii (Honolulu)", "Asia/Manila": "Philippines (Manila)", "Asia/Kolkata": "India (Kolkata)", UTC: "UTC",
};
const zoneName = (zone: string) => ZONE_NAMES[zone] ?? zone.replace(/_/g, " ");

const LENGTHS = [20, 30, 45, 60];
const BUFFERS = [0, 5, 10, 15];

/** `2026-09-22T14:00:00+00:00` → `2026-09-22T14:00`, which is what datetime-local wants. */
function toLocalInput(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A list of options that always contains the stored value, so a legacy 25-minute length shows. */
function withCurrent(options: number[], current: number) {
  return [...new Set([...options, current])].sort((a, b) => a - b);
}

type BlockEditor = { index: number | null; draft: Block };
/** Frosted glass, as on Settings › Carriers (owner, 2026-10-27): the page's glow shows through every card. */
/** The five views of the page, one at a time (owner pick C, 2026-10-26). */
type CalendarTab = "hours" | "appointments" | "blocks" | "rules" | "agency";

export function CalendarAvailabilitySettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  // Edits per member, rather than one draft synchronised by an effect. Switching member then falls
  // out of the render instead of needing a setState in an effect, and unsaved work on one person's
  // week survives a look at somebody else's.
  const [edits, setEdits] = useState<Record<string, Member>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState<CalendarTab>("hours");
  const [blockEditor, setBlockEditor] = useState<BlockEditor | null>(null);
  // The agency's cap is one value for the whole agency, so it is its own draft beside the
  // per-member edits. `undefined` = unchanged.
  const [agencyCap, setAgencyCap] = useState<number | null | undefined>(undefined);
  // The callback reminder lead (20260925711600) is the agency's too; same draft rule.
  const [reminderLead, setReminderLead] = useState<number | null | undefined>(undefined);
  const [linked, setLinked] = useState<Linked | null>(null);
  const [linking, setLinking] = useState("");

  const loadLinked = useCallback(
    () =>
      fetch("/api/app/calendar-connections", { cache: "no-store" })
        .then(async (response) => (response.ok ? ((await response.json()) as Linked) : null))
        .then((body) => setLinked(body))
        .catch(() => setLinked(null)),
    [],
  );

  // The OAuth callback lands back here with ?calendar=<outcome>. Said once, then dropped from the URL.
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("calendar");
    if (!outcome) return;
    const message = CONNECT_OUTCOMES[outcome] ?? CONNECT_OUTCOMES.failed;
    if (outcome === "connected") notify.done(message);
    else notify.fail(message);
    const url = new URL(window.location.href);
    url.searchParams.delete("calendar");
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => { void loadLinked(); }, [loadLinked]);

  // Written as a promise chain rather than async/await with a `finally`, because every setState has
  // to land in a callback: the effect below calls this on mount, and a setState the linter can
  // reach synchronously from an effect body cascades renders. `loading` starts true, so nothing
  // needs to set it before the request goes out.
  const load = useCallback(
    () =>
      fetch("/api/app/availability", { cache: "no-store" })
        .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) }))
        .then(({ ok, body }) => {
          if (!ok) throw new Error(body?.error ?? "Could not load the calendar settings");
          setData(body);
          // Unsaved edits are dropped on reload: the server is now the truth about these weeks.
          setEdits({});
          setAgencyCap(undefined);
          setError("");
        })
        .catch((cause: unknown) => {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Could not load the calendar settings");
        })
        .then(() => setLoading(false)),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  const members = useMemo(() => data?.members ?? [], [data]);
  const active = useMemo(
    () => members.find((member) => member.userId === selected) ?? members[0],
    [members, selected],
  );

  const draft = useMemo(() => (active ? edits[active.userId] ?? active : null), [active, edits]);
  const editable = Boolean(data && draft && (data.canEditOthers || draft.userId === data.selfUserId));
  const savedAgencyCap = data?.agency?.maxPerDay ?? null;
  const agencyDirty = agencyCap !== undefined && agencyCap !== savedAgencyCap;
  // Present only once 20260925711600 is applied; before that the field says so and stays disabled.
  const reminderReady = data?.agency !== undefined && data.agency.callbackReminderMinutes !== undefined;
  const savedReminderLead = data?.agency?.callbackReminderMinutes ?? null;
  const reminderDirty = reminderLead !== undefined && reminderLead !== savedReminderLead;
  const dirty =
    agencyDirty ||
    reminderDirty ||
    Boolean(active && edits[active.userId] && JSON.stringify(edits[active.userId]) !== JSON.stringify(active));
  const schemaReady = data?.schema?.settingsReady !== false;
  const bookingReady = data?.schema?.bookingReady === true;
  const isOwner = Boolean(data?.canEditOthers);

  function setDraft(next: Member) { setEdits((current) => ({ ...current, [next.userId]: next })); setSaveError(""); }
  function setHours(next: Hour[]) { if (draft) setDraft({ ...draft, hours: next }); }
  function setBlocks(next: Block[]) { if (draft) setDraft({ ...draft, blocks: next }); }
  function setPolicy(patch: Partial<Policy>) { if (draft) setDraft({ ...draft, policy: { ...draft.policy, ...patch } }); }

  function discard() {
    if (!active) return;
    setEdits((current) => {
      const next = { ...current };
      delete next[active.userId];
      return next;
    });
    setAgencyCap(undefined);
    setReminderLead(undefined);
    setSaveError("");
    
  }

  async function save(): Promise<boolean> {
    if (!draft) return false;
    const zone = draft.timezone?.trim();
    if (!zone) { setSaveError("Choose the timezone these hours are in."); return false; }
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/app/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: draft.userId,
          timezone: zone,
          hours: draft.hours,
          blocks: draft.blocks.map((block) => ({
            ...(block.id ? { id: block.id } : {}),
            startsAt: new Date(block.startsAt).toISOString(),
            endsAt: new Date(block.endsAt).toISOString(),
            reason: block.reason,
            repeats: block.repeats,
          })),
          policy: draft.policy,
          ...((agencyDirty || reminderDirty) && isOwner
            ? { agency: { ...(agencyDirty ? { maxPerDay: agencyCap ?? null } : {}), ...(reminderDirty ? { callbackReminderMinutes: reminderLead ?? null } : {}) } }
            : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setSaveError(body?.error ?? "Could not save the calendar"); return false; }
      notify.done(`${draft.name}'s calendar saved`);
      
      await load();
      return true;
    } catch {
      setSaveError("Could not save the calendar. Check your connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Link, refresh or unlink the selected member's Google / Outlook calendar. */
  async function linkAction(kind: "connect" | "sync" | "unlink", target: string) {
    if (!draft) return;
    setLinking(`${kind}:${target}`);
    try {
      const response =
        kind === "unlink"
          ? await fetch(`/api/app/calendar-connections?id=${encodeURIComponent(target)}`, { method: "DELETE" })
          : await fetch("/api/app/calendar-connections", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(kind === "connect" ? { action: "connect", provider: target, userId: draft.userId } : { action: "sync", id: target }),
            });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.fail(body?.error ?? "The linked calendar could not be changed"); return; }
      // Consent happens on the provider's page; it sends the browser back to this section.
      if (kind === "connect" && typeof body?.url === "string") { window.location.assign(body.url); return; }
      notify.done(kind === "unlink" ? "Calendar unlinked. Its busy time no longer removes slots." : "Busy time refreshed.");
      await loadLinked();
    } catch {
      notify.fail("The linked calendar could not be reached. Try again.");
    } finally {
      setLinking("");
    }
  }

  // Unsaved changes stop a move away (owner, 2026-10-27): <LeaveGuard> below, the shared guard this
  // page's own one became. Clicks inside rootRef are the page's own.
  const rootRef = useRef<HTMLDivElement>(null);

  const header = (
    <SettingsSectionHeader
      actions={
        editable && draft ? (
          <DraftActions dirty={dirty} saving={saving} onDiscard={discard} onSave={() => void save()} />
        ) : undefined
      }
    />
  );

  if (loading)
    return (
      <SettingsStack>
        {header}
        <p role="status" className="text-sm text-[var(--muted)]">Loading calendar settings…</p>
      </SettingsStack>
    );
  if (error)
    return (
      <SettingsStack>
        {header}
        <Callout tone="error" title="Could not load the calendar settings">
          <span className="block">{error}</span>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); void load(); }}>
            Try again
          </Button>
        </Callout>
      </SettingsStack>
    );
  if (!draft)
    return (
      <SettingsStack>
        {header}
        <DashedCard title="Nobody can take appointments yet">
          Add an owner or a producer under Team &amp; access first — a setter books into their calendar rather than
          having one.
        </DashedCard>
      </SettingsStack>
    );

  const zone = draft.timezone;
  const { appointmentMinutes: length, bufferMinutes: buffer } = draft.policy;
  const openDays = new Set(draft.hours.map((hour) => hour.weekday)).size;
  const busy = !editable || saving;
  // The usual list in its own order; the saved zone and this browser's zone follow it when they are not on it.
  const zoneOptions = [...new Set([...ZONES, ...(zone ? [zone] : []), Intl.DateTimeFormat().resolvedOptions().timeZone])].filter(Boolean);

  // Monday–Friday and friends in one tap: the hours most agents keep (owner pick C, 2026-10-26).
  const presets: Array<{ label: string; days: number[]; from: string; to: string }> = [
    { label: "Mon–Fri, 9–5", days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" },
    { label: "Mon–Fri, 8–6", days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" },
    { label: "Mon–Sat, 9–5", days: [1, 2, 3, 4, 5, 6], from: "09:00", to: "17:00" },
  ];
  const tabs: Array<ViewTab<CalendarTab>> = [
    { key: "hours", label: "Working hours", count: openDays },
    { key: "appointments", label: "Appointments" },
    { key: "blocks", label: "Time off & breaks", count: draft.blocks.length },
    { key: "rules", label: "Booking rules" },
    // A one-agent plan has no agency to set limits for (owner, 2026-10-27).
    ...(data?.isAgency ? [{ key: "agency" as const, label: "Whole agency" }] : []),
  ];
  const view: CalendarTab = tab === "agency" && !data?.isAgency ? "hours" : tab;

  return (
    <div ref={rootRef} className="contents">
    <SettingsStack>
      {header}

      {saveError && <Callout tone="error" title={saveError} />}

      {members.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Whose calendar">
          <span className="text-xs leading-[1.33] font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Whose calendar</span>
          {members.map((member) => {
            const current = member.userId === draft.userId;
            const days = new Set((edits[member.userId] ?? member).hours.map((hour) => hour.weekday)).size;
            return (
              <Button
                key={member.userId}
                type="button"
                aria-pressed={current}
                variant="outline" size="sm" className={current ? "border-[var(--primary)] bg-[var(--brand-50)] text-[var(--accent-ink)]" : ""}
                onClick={() => { setSelected(member.userId); setSaveError(""); }}
              >
                {member.name}
                <span className={cn("text-xs font-normal", days ? "text-[var(--muted)]" : "text-[var(--warning-ink)]")}>{days ? `${days} ${days === 1 ? "day" : "days"}` : "No hours"}</span>
                {edits[member.userId] && <span className="sr-only">, unsaved changes</span>}
              </Button>
            );
          })}
        </div>
      )}

      {!editable && (
        <Callout tone="info" title={`You can see ${draft.name}’s hours but not change them.`}>
          Only an owner can edit somebody else&rsquo;s calendar.
        </Callout>
      )}

      <ViewTabs label="Calendar settings" tabs={tabs} value={view} onChange={setTab} idPrefix="calendar-tab" controls="calendar-panel" />

      <div id="calendar-panel" role="tabpanel" aria-labelledby={`calendar-tab-${view}`}>
        {view === "hours" && (
          <SettingsTableCard
            className={glass}
            headerClassName={cardHead}
            title="Working hours"
            actions={
              <span className="relative inline-flex">
                <label htmlFor="calendar-timezone" className="sr-only">Timezone</label>
                <select
                  id="calendar-timezone"
                  value={zone ?? ""}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, timezone: event.target.value || null })}
                  className={cn(control, "w-[240px]")}
                >
                  <option value="">Choose a timezone…</option>
                  {zoneOptions.map((option) => <option key={option} value={option}>{zoneName(option)}</option>)}
                </select>
              </span>
            }
          >
            {/* A line, not a card (owner, 2026-10-27): an unset week still has to say what it does. */}
            {draft.hours.length === 0 && (
              <p role="status" className="m-0 border-b border-[var(--border)] px-4 py-3 text-xs leading-[1.5] text-[var(--warning-ink)]">
                No hours set. Until they are, an appointment can be booked at any time of day that is legal for the
                customer, and {draft.name} will not appear in the roster or in the dialer&rsquo;s booking panel.
              </p>
            )}
            {editable && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
                <span className="text-xs text-[var(--muted)]">Quick start</span>
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline" size="sm"
                    disabled={busy}
                    onClick={() => setHours(preset.days.map((weekday) => ({ weekday, startTime: preset.from, endTime: preset.to })))}
                  >
                    {preset.label}
                  </Button>
                ))}
                {draft.hours.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setHours([])}>Clear all</Button>
                )}
              </div>
            )}
            <div>
              {WEEK_ORDER.map((weekday) => {
                const spans = draft.hours
                  .map((hour, index) => ({ hour, index }))
                  .filter(({ hour }) => hour.weekday === weekday)
                  .sort((a, b) => a.hour.startTime.localeCompare(b.hour.startTime));
                return (
                  <DayRow
                    key={weekday}
                    weekday={weekday}
                    spans={spans}
                    slots={spans.length ? slotsForDay(draft.hours, weekday, length, buffer) : null}
                    editable={editable}
                    disabled={busy}
                    onOpen={(next) => setHours(next ? [...draft.hours, { weekday, startTime: "09:00", endTime: "17:00" }] : draft.hours.filter((hour) => hour.weekday !== weekday))}
                    onChange={(index, patch) => setHours(draft.hours.map((item, position) => (position === index ? { ...item, ...patch } : item)))}
                    onRemove={(index) => setHours(draft.hours.filter((_, position) => position !== index))}
                    onAdd={() => {
                      const last = spans[spans.length - 1]?.hour;
                      const start = last ? last.endTime : "09:00";
                      const end = last ? (minutesOf(last.endTime) + 60 <= 1439 ? clockHHMM(minutesOf(last.endTime) + 60) : "23:59") : "17:00";
                      setHours([...draft.hours, { weekday, startTime: start, endTime: end }]);
                    }}
                  />
                );
              })}
            </div>
          </SettingsTableCard>
        )}

        {view === "appointments" && (
          <SettingsCard title="Appointments" className={glass}>
            <div className="flex flex-col gap-5">
              <ChipField label="Length" hint="How long one appointment takes.">
                {withCurrent(LENGTHS, length).map((minutes) => (
                  <ToggleChip key={minutes} selected={minutes === length} disabled={busy} onClick={() => setPolicy({ appointmentMinutes: minutes })}>{minutes} min</ToggleChip>
                ))}
              </ChipField>
              <ChipField
                label="Gap after each"
                hint={buffer > 0 ? `Added after each one, so a ${length}-minute appointment takes ${length + buffer} minutes of the day.` : "No gap: one appointment may start the minute the previous one ends."}
              >
                {withCurrent(BUFFERS, buffer).map((minutes) => (
                  <ToggleChip key={minutes} selected={minutes === buffer} disabled={busy} onClick={() => setPolicy({ bufferMinutes: minutes })}>{minutes ? `${minutes} min` : "None"}</ToggleChip>
                ))}
              </ChipField>
            </div>
          </SettingsCard>
        )}

        {view === "blocks" && (
          <PagedProvider>
          <SettingsTableCard
            className={glass}
            headerClassName={cardHead}
            title="Time off & breaks"
            actions={
              editable ? (
                <Button
                  type="button"
                  variant="outline" size="sm"
                  disabled={saving}
                  onClick={() => {
                    const start = new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000);
                    const end = new Date(start.getTime() + 3_600_000);
                    setBlockEditor({ index: null, draft: { startsAt: start.toISOString(), endsAt: end.toISOString(), reason: null, repeats: "none" } });
                  }}
                >
                  <PlusIcon />Block some time
                </Button>
              ) : undefined
            }
          >
            <table className={st.table}>
              <caption className="sr-only">Blocked time, shown in {zone ?? "your browser’s timezone"}. Nothing can be booked across a block, even inside working hours.</caption>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>What</th>
                  <th scope="col" className={cn(st.th, "w-[300px]")}>When</th>
                  <th scope="col" className={cn(st.th, "w-[170px]")}>Repeats</th>
                  <th scope="col" className={cn(st.th, st.num, "w-[200px]")}>Slots lost per week</th>
                  <th scope="col" className={cn(st.th, st.num, "w-[170px]")}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              {draft.blocks.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>
                      Nothing blocked yet.
                    </td>
                  </tr>
                </tbody>
              ) : (
                <PagedBody>
                  {draft.blocks.map((block, index) => {
                    const lost = slotsLostPerWeek(block, draft.hours, zone, length, buffer);
                    return (
                      <tr key={block.id ?? `new-${index}`}>
                        <td className={cn(st.td, st.strong)}>{block.reason || "Blocked"}</td>
                        <td className={st.td}>{blockWhen(block, zone)}</td>
                        <td className={st.td}>{REPEAT_LABELS[block.repeats]}</td>
                        <td className={cn(st.td, st.num)}>{lost == null ? "—" : lost}</td>
                        <td className={cn(st.td, st.num, "whitespace-nowrap")}>
                          {editable && (
                            <>
                              <Button
                                type="button"
                                variant="ghost" size="sm"
                                disabled={saving}
                                aria-label={`Edit ${block.reason || "blocked time"}`}
                                onClick={() => setBlockEditor({ index, draft: { ...block } })}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost" size="sm"
                                disabled={saving}
                                aria-label={`Remove ${block.reason || "blocked time"}`}
                                onClick={() => setBlocks(draft.blocks.filter((_, position) => position !== index))}
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </PagedBody>
              )}
            </table>
            {draft.blocks.length > 10 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <PagedPager total={draft.blocks.length} noun="blocks" />
              </div>
            )}
          </SettingsTableCard>
          </PagedProvider>
        )}

        {view === "rules" && (
          <SettingsTableCard title="Booking rules" className={glass} headerClassName={cardHead}>
            {!schemaReady && (
              <p role="status" className="m-0 border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--warning-ink)]">
                Same-day booking, linked calendars and repeating blocked time can be changed once a pending database update is applied.
              </p>
            )}
            <RuleRow icon={<CalendarClock className="size-4" aria-hidden="true" />} title="Same-day booking" help={draft.policy.allowSameDay ? "People can book for later today." : "The earliest anyone can book is tomorrow."}>
              <Switch id="policy-same-day" checked={draft.policy.allowSameDay} disabled={busy || !schemaReady} onChange={(next) => setPolicy({ allowSameDay: next })} label="Allow same-day booking" />
            </RuleRow>
            <RuleRow icon={<Layers className="size-4" aria-hidden="true" />} title="Double-booking" help={draft.policy.allowDoubleBooking ? "Two appointments can share one time." : "One appointment per time."}>
              <Switch id="policy-double-booking" checked={draft.policy.allowDoubleBooking === true} disabled={busy || !bookingReady} onChange={(next) => setPolicy({ allowDoubleBooking: next })} label="Allow double-booking" />
            </RuleRow>
            <LinkedCalendarRow
              member={draft}
              linked={linked}
              bookingReady={bookingReady && schemaReady}
              editable={editable}
              busy={busy}
              working={linking}
              onToggle={(next) => setPolicy({ honourLinkedCalendars: next })}
              onAction={(kind, target) => void linkAction(kind, target)}
            />
          </SettingsTableCard>
        )}

        {view === "agency" && (
          <SettingsCard title="Whole agency" className={glass}>
            <div className="flex flex-col gap-5">
              <p className="m-0 text-xs text-[var(--muted)]">These apply to every agent, not only {draft.name}. Only an owner can change them.</p>
              <Field
                label="Most appointments a day, whole agency"
                htmlFor="agency-cap"
                hint={
                  !bookingReady
                    ? "All agents together. Can be set once a pending database update is applied."
                    : "All agents together. Leave empty for no agency limit."
                }
              >
                <input
                  id="agency-cap"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  placeholder="No agency limit"
                  className={cn(control, "w-[180px]")}
                  value={(agencyCap === undefined ? savedAgencyCap : agencyCap) ?? ""}
                  disabled={busy || !bookingReady || !isOwner}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    setAgencyCap(next === "" ? null : Math.max(1, Math.min(1000, Math.round(Number(next)) || 1)));
                    setSaveError("");
                  }}
                />
              </Field>
              <Field
                label="Callback reminder"
                htmlFor="callback-reminder-lead"
                hint={
                  !reminderReady
                    ? "Minutes before a callback that its reminder goes out. Can be set once a pending database update is applied."
                    : "Minutes before a callback that its reminder goes out. Leave empty for the platform default."
                }
              >
                <input
                  id="callback-reminder-lead"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={1440}
                  placeholder="Platform default"
                  className={cn(control, "w-[180px]")}
                  value={(reminderLead === undefined ? savedReminderLead : reminderLead) ?? ""}
                  disabled={busy || !reminderReady || !isOwner}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    setReminderLead(next === "" ? null : Math.max(5, Math.min(1440, Math.round(Number(next)) || 5)));
                    setSaveError("");
                  }}
                />
              </Field>
            </div>
          </SettingsCard>
        )}
      </div>

      <BlockDialog
        editor={blockEditor}
        schemaReady={schemaReady}
        onClose={() => setBlockEditor(null)}
        onApply={(block) => {
          if (!blockEditor) return;
          setBlocks(
            blockEditor.index === null
              ? [...draft.blocks, block]
              : draft.blocks.map((item, position) => (position === blockEditor.index ? block : item)),
          );
          setBlockEditor(null);
        }}
      />

      <LeaveGuard dirty={dirty} scope={rootRef} onSave={save} onDiscard={discard} what={`${draft.name}’s calendar`} />
    </SettingsStack>
    </div>
  );
}

/** A labelled row of choice chips: tap one to pick it. */
function ChipField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="block text-label text-[var(--body)]">{label}</span>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      {hint && <span className="mt-1.5 block text-xs leading-[1.5] text-[var(--muted)]">{hint}</span>}
    </div>
  );
}

/** One line of Booking rules, laid out like a Working hours day: icon, what it is, its control. */
function RuleRow({ icon, title, help, children }: { icon: ReactNode; title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-50)] text-[var(--accent-ink)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{title}</span>
        <div className="mt-0.5 text-xs leading-[1.5] text-[var(--muted)]">{help}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Google Calendar's mark: the four-colour G. Colours spelled out, the way the brand gives them. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden="true">
      <path fill="rgb(255, 193, 7)" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="rgb(255, 61, 0)" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="rgb(76, 175, 80)" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="rgb(25, 118, 210)" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

/** Outlook's mark, simplified: the blue tile with its O. */
function OutlookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="3" fill="rgb(0, 120, 212)" />
      <ellipse cx="12" cy="12" rx="4.6" ry="5.2" fill="none" stroke="rgb(255, 255, 255)" strokeWidth="2.2" />
    </svg>
  );
}

const CALENDARS = [
  { id: "google", name: "Google Calendar", Mark: GoogleMark },
  { id: "microsoft", name: "Outlook Calendar", Mark: OutlookMark },
] as const;

/**
 * Linked calendars (owner, 2026-10-27): each person connects their own Google or Outlook account
 * with that provider's sign-in, and the meetings there block those times in Insurvas, read again on
 * their own. One line per calendar on the right, saying where it stands: Connect, or Connected with
 * the account, Refresh and Unlink, or a failed read. Busy time is used by default; someone who
 * switched it off before gets a one-tap way back.
 */
function LinkedCalendarRow({
  member,
  linked,
  bookingReady,
  editable,
  busy,
  working,
  onToggle,
  onAction,
}: {
  member: Member;
  linked: Linked | null;
  bookingReady: boolean;
  editable: boolean;
  busy: boolean;
  working: string;
  onToggle: (next: boolean) => void;
  onAction: (kind: "connect" | "sync" | "unlink", target: string) => void;
}) {
  const mine = (linked?.connections ?? []).filter((connection) => connection.userId === member.userId);
  const connected = mine.filter((connection) => connection.status === "connected" || connection.status === "error");
  const ready = bookingReady && Boolean(linked?.available);

  return (
    <RuleRow
      icon={<CalendarSync className="size-4" aria-hidden="true" />}
      title="Linked calendars"
      help={
        <>
          <span className="block">Connect your Google or Outlook calendar and the meetings there block those times here, updated automatically.</span>
          {connected.length > 0 && !member.policy.honourLinkedCalendars && (
            <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[var(--warning-ink)]">
              Busy time from linked calendars is switched off.
              {editable && (
                <Button type="button" variant="outline" size="sm" disabled={busy || !ready || connected.length === 0} onClick={() => onToggle(true)}>Turn on</Button>
              )}
            </span>
          )}
        </>
      }
    >
      <div className="flex w-[320px] max-w-full flex-col gap-2">
        {CALENDARS.map(({ id, name, Mark }) => {
          const connection = connected.find((item) => item.provider === id) ?? null;
          const configured = (linked?.providers ?? []).some((item) => item.id === id && item.configured);
          const failed = connection?.status === "error";
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] m-glass-inset px-3 py-2">
              <Mark />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--ink)]">{name}</span>
                <span className={cn("block truncate text-xs", failed ? "text-[var(--warning-ink)]" : connection ? "text-[var(--accent-ink)]" : "text-[var(--muted)]")}>
                  {connection
                    ? failed
                      ? `Needs attention${connection.lastError ? `: ${connection.lastError}` : ""}`
                      : `${connection.accountEmail ?? "Connected"} · ${connection.lastSyncedAt ? `updated ${dateTime(connection.lastSyncedAt, viewerTimeZone(), { clock: "12h" })}` : "reading now"}`
                    : !ready
                      ? "Available after a pending database update"
                      : configured
                        ? "Not connected"
                        : "Not available on this workspace yet"}
                </span>
              </span>
              {editable && connection && (
                <span className="inline-flex shrink-0 gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={Boolean(working)} onClick={() => onAction("sync", connection.id)}>
                    {working === `sync:${connection.id}` ? "…" : "Refresh"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={Boolean(working)} onClick={() => onAction("unlink", connection.id)}>Unlink</Button>
                </span>
              )}
              {editable && !connection && (
                <Button
                  type="button"
                  variant="outline" size="sm" className="shrink-0"
                  disabled={Boolean(working) || !ready || !configured}
                  onClick={() => onAction("connect", id)}
                >
                  {working === `connect:${id}` ? "Opening…" : "Connect"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </RuleRow>
  );
}

function clockHHMM(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * One weekday: a switch that opens or closes it, its hours inline (more than one block a day is
 * allowed: a split shift), and how many appointments that leaves.
 */
function DayRow({
  weekday,
  spans,
  slots,
  editable,
  disabled,
  onOpen,
  onChange,
  onRemove,
  onAdd,
}: {
  weekday: number;
  spans: Array<{ hour: Hour; index: number }>;
  slots: number | null;
  editable: boolean;
  disabled: boolean;
  onOpen: (open: boolean) => void;
  onChange: (index: number, patch: Partial<Hour>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const day = WEEKDAYS[weekday];
  const open = spans.length > 0;
  const inverted = spans.some(({ hour }) => hour.startTime >= hour.endTime);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0 xl:grid-cols-[170px_1fr_110px]">
      <div className="flex items-center gap-3">
        <Switch id={`day-${weekday}-open`} checked={open} disabled={disabled || !editable} onChange={onOpen} label={`${day} open`} />
        <label htmlFor={`day-${weekday}-open`} className="text-sm font-semibold text-[var(--ink)]">{day}</label>
      </div>
      <div className="order-3 col-span-2 flex flex-wrap items-center gap-2 xl:order-none xl:col-span-1">
        {!open && <span className="text-sm text-[var(--muted)]">Closed — nothing can be booked</span>}
        {spans.map(({ hour, index }) => (
          <span key={index} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1">
            <label htmlFor={`day-${weekday}-${index}-from`} className="sr-only">{day} opens</label>
            <input
              id={`day-${weekday}-${index}-from`}
              type="time"
              className="h-7 rounded-md border border-transparent bg-transparent px-1 text-sm text-[var(--ink)] outline-none focus-visible:border-[var(--primary)]"
              value={hour.startTime}
              disabled={disabled || !editable}
              onChange={(event) => onChange(index, { startTime: event.target.value })}
            />
            <span className="text-xs text-[var(--muted)]">to</span>
            <label htmlFor={`day-${weekday}-${index}-to`} className="sr-only">{day} closes</label>
            <input
              id={`day-${weekday}-${index}-to`}
              type="time"
              className="h-7 rounded-md border border-transparent bg-transparent px-1 text-sm text-[var(--ink)] outline-none focus-visible:border-[var(--primary)]"
              value={hour.endTime}
              disabled={disabled || !editable}
              onChange={(event) => onChange(index, { endTime: event.target.value })}
            />
            {editable && (
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--error-ink)]"
                disabled={disabled}
                aria-label={`Remove ${day} ${hour.startTime} to ${hour.endTime}`}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {open && editable && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onAdd}>
            <PlusIcon />Add hours
          </Button>
        )}
        {inverted && <p role="alert" className="m-0 w-full text-xs text-[var(--error-ink)]">Hours have to close after they open.</p>}
      </div>
      <span className={cn("order-2 text-right text-sm tabular-nums xl:order-none", open ? "text-[var(--accent-ink)]" : "text-[var(--muted)]")}>
        {slots == null ? "—" : `${slots} ${slots === 1 ? "slot" : "slots"}`}
      </span>
    </div>
  );
}

function BlockDialog({
  editor,
  schemaReady,
  onClose,
  onApply,
}: {
  editor: BlockEditor | null;
  schemaReady: boolean;
  onClose: () => void;
  onApply: (block: Block) => void;
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="border-[var(--border)] bg-[var(--surface)] sm:max-w-lg">
        {editor && <BlockForm key={`${editor.index ?? "new"}`} editor={editor} schemaReady={schemaReady} onClose={onClose} onApply={onApply} />}
      </DialogContent>
    </Dialog>
  );
}

function BlockForm({
  editor,
  schemaReady,
  onClose,
  onApply,
}: {
  editor: BlockEditor;
  schemaReady: boolean;
  onClose: () => void;
  onApply: (block: Block) => void;
}) {
  const [reason, setReason] = useState(editor.draft.reason ?? "");
  const [from, setFrom] = useState(toLocalInput(editor.draft.startsAt));
  const [to, setTo] = useState(toLocalInput(editor.draft.endsAt));
  const [repeats, setRepeats] = useState<BlockRepeat>(editor.draft.repeats);

  const startMs = Date.parse(from);
  const endMs = Date.parse(to);
  const hours = (endMs - startMs) / 3_600_000;
  const period = { none: Infinity, daily: 24, weekdays: 24, weekly: 168, yearly: 8760 }[repeats];
  const problem = !from || !to || Number.isNaN(startMs) || Number.isNaN(endMs)
    ? "Choose when the block starts and ends."
    : endMs <= startMs
      ? "Blocked time has to end after it starts."
      : hours >= period
        ? "A repeating block has to be shorter than the gap between its repeats."
        : null;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem) return;
        onApply({
          ...editor.draft,
          reason: reason.trim() || null,
          startsAt: new Date(from).toISOString(),
          endsAt: new Date(to).toISOString(),
          repeats,
        });
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-[var(--ink)]">{editor.index === null ? "Block some time" : "Edit blocked time"}</DialogTitle>
      </DialogHeader>
      <Field label="What" htmlFor="block-reason">
        <input id="block-reason" className={control} value={reason} maxLength={120} placeholder="Lunch, leave, training…" onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="block-from">
          <DateTimePicker id="block-from" value={from} onChange={setFrom} />
        </Field>
        <Field label="To" htmlFor="block-to">
          <DateTimePicker id="block-to" value={to} onChange={setTo} />
        </Field>
      </div>
      <Field
        label="Repeats"
        htmlFor="block-repeats"
      >
        <select id="block-repeats" className={control} value={repeats} onChange={(event) => setRepeats(event.target.value as BlockRepeat)}>
          {BLOCK_REPEATS.map((value) => (
            <option key={value} value={value} disabled={!schemaReady && value !== "none"}>{REPEAT_LABELS[value]}</option>
          ))}
        </select>
      </Field>
      {problem && from && to && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{problem}</p>}
      <div className="flex justify-end gap-2.5">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit"  disabled={Boolean(problem)}>
          {editor.index === null ? "Add block" : "Update block"}
        </Button>
      </div>
    </form>
  );
}
