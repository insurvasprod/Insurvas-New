"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  DashedCard,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  ToggleRow,
  btn,
  control,
  st,
} from "@/components/app/settings/primitives";
import {
  BLOCK_REPEATS,
  REPEAT_LABELS,
  WEEKDAYS,
  blockWhen,
  clockLabel,
  minutesOf,
  slotsForDay,
  slotsLostPerWeek,
  type BlockRepeat,
} from "@/lib/appointments/calendarMath";
import {
  providerLabel,
  type CalendarConnectionView,
  type CalendarProviderView,
} from "@/lib/appointments/linkedCalendarsShared";
import { cn } from "@/lib/utils";

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
  const [openDay, setOpenDay] = useState<number | null>(null);
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
    setOpenDay(null);
  }

  async function save() {
    if (!draft) return;
    const zone = draft.timezone?.trim();
    if (!zone) { setSaveError("Choose the timezone these hours are in."); return; }
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
      if (!response.ok) { setSaveError(body?.error ?? "Could not save the calendar"); return; }
      notify.done(`${draft.name}'s calendar saved`);
      setOpenDay(null);
      await load();
    } catch {
      setSaveError("Could not save the calendar. Check your connection and try again.");
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
        <p role="status" className="text-[14px] text-[var(--muted)]">Loading calendar settings…</p>
      </SettingsStack>
    );
  if (error)
    return (
      <SettingsStack>
        {header}
        <Callout tone="error" title="Could not load the calendar settings">
          <span className="block">{error}</span>
          <button type="button" className={btn("secondary", "mt-3")} onClick={() => { setLoading(true); void load(); }}>
            Try again
          </button>
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
  const zoneOptions = [...new Set([...(zone ? [zone] : []), Intl.DateTimeFormat().resolvedOptions().timeZone, ...ZONES])].filter(Boolean);

  return (
    <SettingsStack>
      {header}

      {saveError && <Callout tone="error" title={saveError} />}

      {members.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Whose calendar">
          <span className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Member</span>
          {members.map((member) => {
            const current = member.userId === draft.userId;
            const days = new Set((edits[member.userId] ?? member).hours.map((hour) => hour.weekday)).size;
            return (
              <button
                key={member.userId}
                type="button"
                aria-pressed={current}
                className={btn("secondary", current ? "border-[var(--primary)] bg-[var(--brand-50)] text-[var(--accent-ink)]" : "")}
                onClick={() => { setSelected(member.userId); setOpenDay(null); setSaveError(""); }}
              >
                {member.name}
                <span className="text-[12px] font-normal text-[var(--muted)]">{days ? `${days}d` : "—"}</span>
                {edits[member.userId] && <span className="sr-only">, unsaved changes</span>}
              </button>
            );
          })}
        </div>
      )}

      {!editable && (
        <Callout tone="info" title={`You can see ${draft.name}’s hours but not change them.`}>
          Only an owner can edit somebody else&rsquo;s calendar.
        </Callout>
      )}

      <Callout tone="info" title="This is the source, not a copy">
        The booking check, the dialer&rsquo;s booking panel and appointment reminders all read these hours. There is
        no second place to set them, which is why a change here moves which times can be booked from the next booking on.
      </Callout>

      {draft.hours.length === 0 && (
        <Callout tone="warning" title="No hours set">
          Until they are, an appointment can be booked at any time of day that is legal for the customer, and{" "}
          {draft.name} will not appear in the roster or in the dialer&rsquo;s booking panel.
        </Callout>
      )}

      <SettingsTableCard
        title="Working hours"
        actions={
          <>
            <span className="relative inline-flex">
              <label htmlFor="calendar-timezone" className="sr-only">Timezone</label>
              <select
                id="calendar-timezone"
                value={zone ?? ""}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value || null })}
                className="h-6 cursor-pointer appearance-none rounded-full border-0 bg-[var(--surface)] py-0 pr-7 pl-2.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--body)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-default"
              >
                <option value="">Choose a timezone…</option>
                {zoneOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="pointer-events-none absolute top-[7px] right-2.5 text-[var(--muted)]">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            <Pill tone={openDays > 0 ? "success" : "warning"} dot>
              {openDays > 0 ? `${openDays} ${openDays === 1 ? "day" : "days"} open` : "No days open"}
            </Pill>
          </>
        }
      >
        <table className={st.table}>
          <caption className="sr-only">
            Working hours in {zone ?? "no timezone yet"}. These are {draft.name}&rsquo;s own hours, not the customer&rsquo;s;
            the customer&rsquo;s legal calling window is checked separately and both must be satisfied.
          </caption>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Day</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Opens</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Closes</th>
              <th scope="col" className={cn(st.th, st.num, "w-[220px]")}>Slots at {length} + {buffer} min</th>
              <th scope="col" className={cn(st.th, st.num)}><span className="sr-only">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {WEEK_ORDER.map((weekday) => {
              const spans = draft.hours
                .map((hour, index) => ({ hour, index }))
                .filter(({ hour }) => hour.weekday === weekday)
                .sort((a, b) => a.hour.startTime.localeCompare(b.hour.startTime));
              const open = spans.length > 0;
              const expanded = openDay === weekday;
              return (
                <DayRows
                  key={weekday}
                  weekday={weekday}
                  spans={spans}
                  open={open}
                  expanded={expanded}
                  slots={open ? slotsForDay(draft.hours, weekday, length, buffer) : null}
                  editable={editable}
                  disabled={busy}
                  onToggle={() => setOpenDay(expanded ? null : weekday)}
                  onChange={(index, patch) => setHours(draft.hours.map((item, position) => (position === index ? { ...item, ...patch } : item)))}
                  onRemove={(index) => setHours(draft.hours.filter((_, position) => position !== index))}
                  onAdd={() => {
                    const last = spans[spans.length - 1]?.hour;
                    const start = last ? last.endTime : "09:00";
                    const end = last ? (minutesOf(last.endTime) + 60 <= 1439 ? clockHHMM(minutesOf(last.endTime) + 60) : "23:59") : "17:00";
                    setHours([...draft.hours, { weekday, startTime: start, endTime: end }]);
                  }}
                  onClose={() => setHours(draft.hours.filter((hour) => hour.weekday !== weekday))}
                />
              );
            })}
          </tbody>
        </table>
      </SettingsTableCard>

      <SettingsGrid>
        <SettingsCard title="Capacity">
          <div className="flex flex-col gap-4">
            <Field label="Appointment length" htmlFor="policy-minutes">
              <select
                id="policy-minutes"
                className={control}
                value={length}
                disabled={busy}
                onChange={(event) => setPolicy({ appointmentMinutes: Number(event.target.value) })}
              >
                {withCurrent(LENGTHS, length).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </Field>
            <Field
              label="Buffer between appointments"
              htmlFor="policy-buffer"
              hint={
                buffer > 0
                  ? `Added after each one, so a ${length}-minute slot consumes ${length + buffer}.`
                  : "No gap: one appointment may start the minute the previous one ends."
              }
            >
              <select
                id="policy-buffer"
                className={control}
                value={buffer}
                disabled={busy}
                onChange={(event) => setPolicy({ bufferMinutes: Number(event.target.value) })}
              >
                {withCurrent(BUFFERS, buffer).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </Field>
            <Field
              label="Maximum per day"
              htmlFor="agency-cap"
              hint={
                !bookingReady
                  ? "Across the whole agency, not per agent. Can be set once a pending database update is applied."
                  : !isOwner
                    ? "Across the whole agency, not per agent. Only an owner changes it."
                    : "Across the whole agency, not per agent."
              }
            >
              <input
                id="agency-cap"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                placeholder="No agency limit"
                className={control}
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
                  : !isOwner
                    ? "Minutes before a callback that its reminder goes out, for the whole agency. Only an owner changes it."
                    : "Minutes before a callback that its reminder goes out, for the whole agency. Leave empty for the platform default."
              }
            >
              <input
                id="callback-reminder-lead"
                type="number"
                inputMode="numeric"
                min={5}
                max={1440}
                placeholder="Platform default"
                className={control}
                value={(reminderLead === undefined ? savedReminderLead : reminderLead) ?? ""}
                disabled={busy || !reminderReady || !isOwner}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  setReminderLead(next === "" ? null : Math.max(5, Math.min(1440, Math.round(Number(next)) || 5)));
                  setSaveError("");
                }}
              />
            </Field>
            {/* Kept: the per-agent limit predates the agency one and is still enforced beside it. */}
            <Field
              label={`Maximum per day for ${draft.name}`}
              htmlFor="policy-cap"
              hint={`For ${draft.name} alone, counted in their own day. Both limits apply; the server refuses the next booking once either is reached.`}
            >
              <input
                id="policy-cap"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                className={control}
                value={draft.policy.maxPerDay}
                disabled={busy}
                onChange={(event) => setPolicy({ maxPerDay: Number(event.target.value) })}
              />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Booking policy" bodyClassName="mt-[18px]">
          <div className="flex flex-col gap-5">
            {!schemaReady && (
              <Callout tone="warning" title="This setting needs a database update that has not been applied yet.">
                Same-day booking, linked calendars and repeating blocked time can be changed once it is. Everything
                else on this page saves as usual.
              </Callout>
            )}
            <ToggleRow
              id="policy-same-day"
              title="Allow same-day booking"
              help={`When off, nothing can be booked for later today in ${zone ?? "this calendar’s timezone"}; the earliest bookable day is tomorrow.`}
              checked={draft.policy.allowSameDay}
              disabled={busy || !schemaReady}
              onChange={(next) => setPolicy({ allowSameDay: next })}
            />
            <ToggleRow
              id="policy-double-booking"
              title="Allow double-booking"
              help={
                bookingReady
                  ? "Two appointments in one slot."
                  : "Two appointments in one slot. Can be switched on once a pending database update is applied; until then the database refuses the second appointment, buffer included."
              }
              checked={draft.policy.allowDoubleBooking === true}
              disabled={busy || !bookingReady}
              onChange={(next) => setPolicy({ allowDoubleBooking: next })}
            />
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
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsTableCard
        title="Blocked time"
        actions={
          editable ? (
            <button
              type="button"
              className={btn("secondary")}
              disabled={saving}
              onClick={() => {
                const start = new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000);
                const end = new Date(start.getTime() + 3_600_000);
                setBlockEditor({ index: null, draft: { startsAt: start.toISOString(), endsAt: end.toISOString(), reason: null, repeats: "none" } });
              }}
            >
              <PlusIcon />Block some time
            </button>
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
          <tbody>
            {draft.blocks.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>
                  No blocked time. Lunch, leave, training — anything added here cannot be booked across.
                </td>
              </tr>
            ) : (
              draft.blocks.map((block, index) => {
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
                          <button
                            type="button"
                            className={btn("row")}
                            disabled={saving}
                            aria-label={`Edit ${block.reason || "blocked time"}`}
                            onClick={() => setBlockEditor({ index, draft: { ...block } })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={btn("row")}
                            disabled={saving}
                            aria-label={`Remove ${block.reason || "blocked time"}`}
                            onClick={() => setBlocks(draft.blocks.filter((_, position) => position !== index))}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </SettingsTableCard>

      <BlockDialog
        editor={blockEditor}
        zone={zone}
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
    </SettingsStack>
  );
}

/**
 * "Honour linked calendars", tied to whether this member actually has a calendar linked. With none
 * linked there is no busy time to honour, so the switch is shown as it is stored but cannot be
 * changed, and the row offers the link instead (or says the link is not set up on this deployment).
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
  const configured = (linked?.providers ?? []).filter((provider) => provider.configured);
  const unlinkedProviders = configured.filter((provider) => !connected.some((connection) => connection.provider === provider.id));
  const ready = bookingReady && Boolean(linked?.available);

  const help = !ready
    ? "Busy time in Google or Outlook removes the slot. Linking a calendar needs a database update that has not been applied yet."
    : connected.length === 0
      ? configured.length === 0
        ? `Busy time in Google or Outlook removes the slot. Linking Google or Outlook is not set up on this workspace yet, so ${member.name} has no calendar to honour.`
        : `Busy time in Google or Outlook removes the slot. ${member.name} has no calendar linked yet — link one to use this.`
      : "Busy time in Google or Outlook removes the slot.";

  return (
    <div className="flex flex-col gap-2.5">
      <ToggleRow
        id="policy-linked-calendars"
        title="Honour linked calendars"
        help={help}
        checked={member.policy.honourLinkedCalendars}
        disabled={busy || !ready || connected.length === 0}
        onChange={onToggle}
      />
      {ready && connected.map((connection) => (
        <div key={connection.id} className="flex flex-wrap items-center gap-2 text-[12px] leading-[1.5] text-[var(--muted)]">
          <Pill tone={connection.status === "error" ? "warning" : "success"} dot>{providerLabel(connection.provider)}</Pill>
          <span className="min-w-0">
            {connection.accountEmail ?? "Linked account"}
            {connection.status === "error"
              ? ` · last sync failed${connection.lastError ? `: ${connection.lastError}` : ""}`
              : connection.lastSyncedAt
                ? ` · busy time read ${dateTime(connection.lastSyncedAt, viewerTimeZone(), { clock: "12h" })}`
                : " · not read yet"}
          </span>
          {editable && (
            <span className="ml-auto inline-flex gap-1">
              <button type="button" className={btn("row")} disabled={Boolean(working)} onClick={() => onAction("sync", connection.id)}>
                {working === `sync:${connection.id}` ? "Refreshing…" : "Refresh"}
              </button>
              <button type="button" className={btn("danger-row")} disabled={Boolean(working)} onClick={() => onAction("unlink", connection.id)}>
                Unlink
              </button>
            </span>
          )}
        </div>
      ))}
      {ready && editable && unlinkedProviders.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {unlinkedProviders.map((provider) => (
            <button key={provider.id} type="button" className={btn("secondary")} disabled={Boolean(working)} onClick={() => onAction("connect", provider.id)}>
              {working === `connect:${provider.id}` ? "Opening…" : `Link ${provider.label}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function clockHHMM(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function DayRows({
  weekday,
  spans,
  open,
  expanded,
  slots,
  editable,
  disabled,
  onToggle,
  onChange,
  onRemove,
  onAdd,
  onClose,
}: {
  weekday: number;
  spans: Array<{ hour: Hour; index: number }>;
  open: boolean;
  expanded: boolean;
  slots: number | null;
  editable: boolean;
  disabled: boolean;
  onToggle: () => void;
  onChange: (index: number, patch: Partial<Hour>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const day = WEEKDAYS[weekday];
  const inverted = spans.some(({ hour }) => hour.startTime >= hour.endTime);
  return (
    <>
      <tr>
        <td className={st.td}>{day}</td>
        <td className={st.td}>
          {open ? spans.map(({ hour, index }) => <span key={index} className="block">{clockLabel(minutesOf(hour.startTime))}</span>) : "—"}
        </td>
        <td className={st.td}>
          {open ? spans.map(({ hour, index }) => <span key={index} className="block">{clockLabel(minutesOf(hour.endTime))}</span>) : "—"}
        </td>
        <td className={cn(st.td, st.num)}>{slots == null ? "—" : slots}</td>
        <td className={cn(st.td, st.num, "whitespace-nowrap")}>
          <span className="inline-flex items-center gap-1">
            <Pill tone={open ? "success" : "neutral"}>{open ? "Open" : "Closed"}</Pill>
            {editable && (
              <button type="button" className={btn("row")} aria-expanded={expanded} aria-label={`Edit ${day}’s hours`} onClick={onToggle}>
                {expanded ? "Done" : "Edit"}
              </button>
            )}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className={cn(st.td, "bg-[var(--surface-alt)]")}>
            <div className="flex flex-col gap-3 py-1">
              {spans.length === 0 && <p className="m-0 text-[14px] text-[var(--muted)]">{day} is closed. Add hours to open it.</p>}
              {spans.map(({ hour, index }) => (
                <div key={index} className="flex flex-wrap items-end gap-3">
                  <Field label="Opens" htmlFor={`day-${weekday}-${index}-from`} className="w-[150px]">
                    <input
                      id={`day-${weekday}-${index}-from`}
                      type="time"
                      className={control}
                      value={hour.startTime}
                      disabled={disabled}
                      onChange={(event) => onChange(index, { startTime: event.target.value })}
                    />
                  </Field>
                  <Field label="Closes" htmlFor={`day-${weekday}-${index}-to`} className="w-[150px]">
                    <input
                      id={`day-${weekday}-${index}-to`}
                      type="time"
                      className={control}
                      value={hour.endTime}
                      disabled={disabled}
                      onChange={(event) => onChange(index, { endTime: event.target.value })}
                    />
                  </Field>
                  <button
                    type="button"
                    className={btn("danger-row", "mb-[7px]")}
                    disabled={disabled}
                    aria-label={`Remove ${day} ${hour.startTime} to ${hour.endTime}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {inverted && (
                <p role="alert" className="m-0 text-[12px] text-[var(--error-ink)]">A working block has to close after it opens.</p>
              )}
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className={btn("secondary")} disabled={disabled} onClick={onAdd}>
                  <PlusIcon />{spans.length ? "Add another block" : "Add hours"}
                </button>
                {spans.length > 0 && (
                  <button type="button" className={btn("row")} disabled={disabled} onClick={onClose}>
                    Close {day}
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BlockDialog({
  editor,
  zone,
  schemaReady,
  onClose,
  onApply,
}: {
  editor: BlockEditor | null;
  zone: string | null;
  schemaReady: boolean;
  onClose: () => void;
  onApply: (block: Block) => void;
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="border-[var(--border)] bg-[var(--surface)] sm:max-w-lg">
        {editor && <BlockForm key={`${editor.index ?? "new"}`} editor={editor} zone={zone} schemaReady={schemaReady} onClose={onClose} onApply={onApply} />}
      </DialogContent>
    </Dialog>
  );
}

function BlockForm({
  editor,
  zone,
  schemaReady,
  onClose,
  onApply,
}: {
  editor: BlockEditor;
  zone: string | null;
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
        <DialogDescription className="text-[var(--muted)]">
          Nothing can be booked across a block, even inside working hours. Times are entered in your browser&rsquo;s
          time{zone ? ` and shown on the page in ${zone}` : ""}; a repeating block repeats that wall-clock time.
        </DialogDescription>
      </DialogHeader>
      <Field label="What" htmlFor="block-reason">
        <input id="block-reason" className={control} value={reason} maxLength={120} placeholder="Lunch, leave, training…" onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="block-from">
          <input id="block-from" type="datetime-local" className={control} value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="To" htmlFor="block-to">
          <input id="block-to" type="datetime-local" className={control} value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>
      <Field
        label="Repeats"
        htmlFor="block-repeats"
        hint={schemaReady ? "Every weekday and every day repeat the time; weekly repeats the weekday; yearly repeats the date." : "Repeating blocks can be saved once the pending database update is applied."}
      >
        <select id="block-repeats" className={control} value={repeats} onChange={(event) => setRepeats(event.target.value as BlockRepeat)}>
          {BLOCK_REPEATS.map((value) => (
            <option key={value} value={value} disabled={!schemaReady && value !== "none"}>{REPEAT_LABELS[value]}</option>
          ))}
        </select>
      </Field>
      {problem && from && to && <p role="alert" className="m-0 text-[12px] text-[var(--error-ink)]">{problem}</p>}
      <div className="flex justify-end gap-2.5">
        <button type="button" className={btn("ghost")} onClick={onClose}>Cancel</button>
        <button type="submit" className={btn("primary")} disabled={Boolean(problem)}>
          {editor.index === null ? "Add block" : "Update block"}
        </button>
      </div>
      <p className="m-0 text-[12px] text-[var(--muted)]">Blocks are written with the rest of the calendar when you choose Save changes.</p>
    </form>
  );
}
