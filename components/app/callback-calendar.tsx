"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, ExternalLink, Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { insideWindow, hourLabel, STATE_NAMES, windowSummary, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import type { CallbackView } from "@/lib/callbacks/service";
import type { CallbackRefusalNotice } from "@/lib/callbacks/refusals";
import type { NearestLegalTime } from "@/lib/callbacks/nearest";

/**
 * Callbacks (p-app-callbacks): what is overdue, what is due today, what is coming, and one card to
 * book a callback in the customer's own time — with the calling window checked while the agent
 * picks, and again by the server before anything is stored.
 *
 * LA-1 §6.3 (concept board): a callback counts when the call comes back. A contact on a dial of the
 * lead from 15 minutes before it is due to the end of the customer's day keeps it; the customer's
 * window closing on the due day with no kept call misses it (20260925708500/708700). A refused time
 * comes back with the nearest legal one, as a suggestion only.
 */
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const OPEN_STATUSES = new Set(["scheduled", "due", "missed"]);
const THIRTY_DAYS = 30 * 86_400_000;
/** Below this many settled callbacks a source's kept rate is noise, and naming the worst would be unfair. */
const MIN_SOURCE_SAMPLE = 5;

type ChipTone = "neutral" | "success" | "warning" | "error" | "accent";
type Viewer = { userId: string; role: string };
type Scope = "mine" | "all";

function localParts(utc: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour === "24" ? "00" : values.hour}:${values.minute}` };
}

/** "11:00 am EDT" — the time as a person says it, with the zone it is in. */
function shortTime(utc: string | Date, timezone: string, withZone = true) {
  const text = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }).format(new Date(utc));
  return text.replace(" AM", " am").replace(" PM", " pm");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A fixed month list: some browsers' locale data spells September "Sept", and the boards say "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 25 Sep · 2:30 pm MST" */
function longTime(utc: string | Date, timezone: string) {
  const { date } = localParts(utc, timezone);
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]} · ${shortTime(utc, timezone)}`;
}

function zoneAbbreviation(timezone: string, at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

/** The instant a customer-local "YYYY-MM-DDTHH:mm" names in `timezone` (DST-safe to the minute). */
function zonedToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const seen = localParts(new Date(guess), timezone);
    const [sy, smo, sd] = seen.date.split("-").map(Number);
    const [sh, smi] = seen.time.split(":").map(Number);
    guess -= Date.UTC(sy, smo - 1, sd, sh, smi) - Date.UTC(y, mo - 1, d, h, mi);
  }
  return new Date(guess);
}

function durationShort(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** Missed once, whatever happened after: a rebooked missed callback still counts as missed. */
function wasMissed(callback: CallbackView) {
  return callback.status !== "completed" && (callback.status === "missed" || Boolean(callback.missedAt));
}

function rowStatus(callback: CallbackView, now: number, callWindow: CallbackWindowFacts | undefined): { label: string; tone: ChipTone } {
  const at = new Date(callback.scheduledAtUtc).getTime();
  const minutes = Math.round((at - now) / 60_000);
  if (callback.status === "missed") return { label: "Missed — window closed", tone: "error" };
  if (callback.isOverdue) return { label: `${durationShort(Math.max(1, -minutes))} overdue`, tone: "error" };
  if (minutes >= 0 && minutes <= 60) return { label: `in ${Math.max(1, minutes)} min`, tone: "accent" };
  // A callback booked close to the end of the customer's window leaves no second chance today.
  if (callWindow && callback.isDueToday) {
    const { time } = localParts(callback.scheduledAtUtc, callback.customerTimezone);
    const [h, m] = time.split(":").map(Number);
    if (callWindow.effective.end * 60 - (h * 60 + m) <= 90) return { label: `Window closes ${hourLabel(callWindow.effective.end)}`, tone: "warning" };
  }
  return { label: "Scheduled", tone: "neutral" };
}

function Chip({ tone, children, dot = true }: { tone: ChipTone; children: React.ReactNode; dot?: boolean }) {
  return <span className={`portal-status-chip is-${tone}`}>{dot && <span aria-hidden="true" />}{children}</span>;
}

const SHOW_CALLBACK_DEMO = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_CALLBACKS === "true";

function createDemoCallbacks(): CallbackView[] {
  const entries = [
    { id: "demo-callback-1", name: "Michael Torres", product: "Whole Life Inquiry", offset: 1, timezone: "America/Los_Angeles", state: "CA", note: "Discuss options and next steps", status: "scheduled" as const, phone: "(555) 289-1034", email: "michael.torres@example.com" },
    { id: "demo-callback-2", name: "Emily Carter", product: "Final Application", offset: 3, timezone: "America/Chicago", state: "IL", note: "Check in on application status", status: "scheduled" as const, phone: "(555) 418-2077", email: "emily.carter@example.com" },
    { id: "demo-callback-3", name: "Sarah Reynolds", product: "Term Life Quote", offset: -4, timezone: "America/Los_Angeles", state: "CA", note: "Follow up on quote and answer questions", status: "missed" as const, phone: "(555) 627-1108", email: "sarah.reynolds@example.com" },
    { id: "demo-callback-4", name: "Robert Wilson", product: "Beneficiary Update", offset: 27, timezone: "America/Denver", state: "CO", note: "Confirm beneficiary details", status: "scheduled" as const, phone: "(555) 301-8842", email: "robert.wilson@example.com" },
  ];
  const agentZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return entries.map((entry) => {
    const scheduledAtUtc = new Date(Date.now() + entry.offset * 3_600_000).toISOString();
    return {
      id: entry.id, leadId: `demo-lead-${entry.id.slice(-1)}`, workItemId: `demo-work-item-${entry.id.slice(-1)}`, customerName: entry.name, scheduledAtUtc,
      customerTimezone: entry.timezone, customerTime: longTime(scheduledAtUtc, entry.timezone), agentTime: longTime(scheduledAtUtc, agentZone), assignedTo: "demo-agent",
      assigneeName: "Jordan Davis", assigneeRole: "agent", note: entry.note, status: entry.status, productName: entry.product, phone: entry.phone, email: entry.email,
      state: entry.state, attemptNumber: 2, sourceName: "Demo source",
      isOverdue: entry.status === "missed", isDueToday: entry.status !== "missed" && entry.offset < 12,
      history: [{ id: `${entry.id}-history`, action: "scheduled", createdAt: scheduledAtUtc, actorName: "Demo Agent", oldScheduledAtUtc: null, newScheduledAtUtc: scheduledAtUtc, oldStatus: null, newStatus: "scheduled", note: entry.note, via: null }],
      completedVia: null, missedAt: entry.status === "missed" ? scheduledAtUtc : null, reopenedAt: null, releasedAt: null, inbound: false,
      isDemo: true,
    };
  });
}

/** Where a due callback's lead is right now: with the agent who booked it, or in the shared queue. */
function holderLine(callback: CallbackView, showAssignee: boolean) {
  if (callback.releasedAt) return "in the shared queue";
  if (callback.reopenedAt) return `with ${callback.assigneeName}`;
  return showAssignee ? callback.assigneeName : null;
}

function CallbackRow({ callback, now, callWindow, yourZone, selected, readOnly, showAssignee, onReschedule }: {
  callback: CallbackView; now: number; callWindow: CallbackWindowFacts | undefined; yourZone: string; selected: boolean; readOnly: boolean; showAssignee: boolean; onReschedule: () => void;
}) {
  const status = rowStatus(callback, now, callWindow);
  const second = [callback.phone, `attempt ${callback.attemptNumber}`, callback.sourceName, holderLine(callback, showAssignee)].filter(Boolean).join(" · ");
  const callable = callback.isOverdue || callback.isDueToday;
  // An overdue callback from an earlier day shows the day it was promised, not only the time.
  const withDate = !callback.isDueToday;
  return (
    <div className={`portal-callbacks-row${selected ? " is-selected" : ""}`}>
      <span className="portal-callbacks-who">
        <strong>{callback.customerName}</strong>
        <small>{second}</small>
        {callback.note && <small className="text-[var(--body)]" title={callback.note}>&ldquo;{callback.note}&rdquo;</small>}
      </span>
      <span className="portal-callbacks-when">
        <strong>{withDate ? longTime(callback.scheduledAtUtc, callback.customerTimezone) : shortTime(callback.scheduledAtUtc, callback.customerTimezone)}</strong>
        <small>{shortTime(callback.scheduledAtUtc, yourZone, false)} your time</small>
      </span>
      <Chip tone={status.tone}>{status.label}</Chip>
      <span className="portal-callbacks-actions">
        {!callback.isDemo && <Link className="portal-callbacks-link" href={`/app/leads/${callback.leadId}`}>Open lead</Link>}
        {callable && (
          <Button asChild size="sm" title="Opens the dialer on this lead">
            <Link href={callback.isDemo ? "/app/dialer" : `/app/dialer?lead=${encodeURIComponent(callback.leadId)}`}>Call now</Link>
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={readOnly || callback.isDemo} onClick={onReschedule} aria-pressed={selected}>Reschedule</Button>
      </span>
    </div>
  );
}

function Panel({ title, count, chip, children }: { title: string; count: number; chip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="portal-callbacks-panel" aria-label={`${title}, ${count}`}>
      <div className="portal-callbacks-panel-bar"><h2>{title} &mdash; {count}</h2>{chip}</div>
      {children}
    </section>
  );
}

function settledLabel(callback: CallbackView): { label: string; tone: ChipTone } {
  if (callback.status === "completed") return callback.completedVia === "manual" ? { label: "Marked done", tone: "success" } : { label: "Kept", tone: "success" };
  if (wasMissed(callback)) return { label: "Missed", tone: "error" };
  return { label: "Cancelled", tone: "neutral" };
}

export function CallbackCalendar({ readOnly }: { readOnly: boolean }) {
  const [callbacks, setCallbacks] = useState<CallbackView[]>([]);
  const [windows, setWindows] = useState<Record<string, CallbackWindowFacts>>({});
  const [refusals, setRefusals] = useState<CallbackRefusalNotice[]>([]);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [yourZone, setYourZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ id: string; date: string; time: string } | null>(null);
  const [nearest, setNearest] = useState<{ id: string; local: string; value: NearestLegalTime | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [demoPreview, setDemoPreview] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/app/callbacks", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error ?? "Could not load callbacks.");
    else {
      const live = (body.callbacks ?? []) as CallbackView[];
      const next = live.length === 0 && SHOW_CALLBACK_DEMO ? createDemoCallbacks() : live;
      setDemoPreview(next.some((item) => item.isDemo === true));
      setCallbacks(next);
      setWindows((body.windows ?? {}) as Record<string, CallbackWindowFacts>);
      setRefusals(Array.isArray(body.refusals) ? body.refusals as CallbackRefusalNotice[] : []);
      const who = body.viewer && typeof body.viewer.userId === "string" ? body.viewer as Viewer : null;
      setViewer(who);
      // Owners start on every callback in the workspace; everyone else on their own.
      setScope((current) => current ?? (who && who.role !== "owner" ? "mine" : "all"));
      // "Your time" is the viewer's own zone (saved with their working hours), else the browser's —
      // never the agency's, which is nobody's clock in particular (LA-1.22).
      if (typeof body.viewerTimezone === "string" && body.viewerTimezone) setYourZone(body.viewerTimezone);
      // Book a callback opens on the most urgent open callback, as the board does.
      const mineFirst = who && who.role !== "owner" ? next.filter((item) => item.assignedTo === who.userId || item.isDemo) : next;
      const open = mineFirst.filter((item) => OPEN_STATUSES.has(item.status));
      const keep = selectedIdRef.current && next.some((item) => item.id === selectedIdRef.current) ? selectedIdRef.current : (open.find((item) => item.isOverdue) ?? open.find((item) => item.isDueToday) ?? open[0])?.id ?? null;
      selectedIdRef.current = keep;
      setSelectedId(keep);
    }
    setLoading(false);
  }, []);

  // The page is a client-side snapshot of the protected callback API and loads on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const mineOnly = scope === "mine" && viewer !== null;
  const visible = useMemo(() => (mineOnly ? callbacks.filter((item) => item.isDemo || item.assignedTo === viewer?.userId) : callbacks), [callbacks, mineOnly, viewer]);
  const open = useMemo(() => visible.filter((item) => OPEN_STATUSES.has(item.status)), [visible]);
  const overdue = useMemo(() => open.filter((item) => item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const dueToday = useMemo(() => open.filter((item) => item.isDueToday && !item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const upcoming = useMemo(() => open.filter((item) => !item.isDueToday && !item.isOverdue).sort((a, b) => a.scheduledAtUtc.localeCompare(b.scheduledAtUtc)), [open]);
  const settledOf = useCallback((items: CallbackView[]) => items.filter((item) => (item.status === "completed" || item.status === "missed" || item.status === "cancelled") && now - new Date(item.scheduledAtUtc).getTime() <= THIRTY_DAYS), [now]);
  const settledRecent = useMemo(() => settledOf(visible), [settledOf, visible]);
  const kept = settledRecent.filter((item) => item.status === "completed").length;
  const keptByHand = settledRecent.filter((item) => item.status === "completed" && item.completedVia === "manual").length;
  const missed = settledRecent.filter(wasMissed).length;
  const keptRate = kept + missed ? (kept / (kept + missed)) * 100 : null;
  const isOwner = viewer?.role === "owner";
  // Kept rate by source — owners only, informational. Every source, the workspace's whole 30 days.
  const sourceRates = useMemo(() => {
    const bySource = new Map<string, { kept: number; settled: number }>();
    for (const item of settledOf(callbacks)) {
      if (!item.sourceName) continue;
      const isKept = item.status === "completed";
      if (!isKept && !wasMissed(item)) continue;
      const entry = bySource.get(item.sourceName) ?? { kept: 0, settled: 0 };
      entry.settled += 1;
      if (isKept) entry.kept += 1;
      bySource.set(item.sourceName, entry);
    }
    return [...bySource].map(([name, entry]) => ({ name, ...entry, rate: (entry.kept / entry.settled) * 100 })).sort((a, b) => b.rate - a.rate || b.settled - a.settled);
  }, [callbacks, settledOf]);
  // The source whose callbacks are kept least often — a partner or vendor whose leads do not answer.
  const worstSource = useMemo(() => {
    const eligible = sourceRates.filter((entry) => entry.settled >= MIN_SOURCE_SAMPLE);
    if (eligible.length < 2) return null;
    return [...eligible].sort((a, b) => a.rate - b.rate)[0];
  }, [sourceRates]);
  const visibleRefusals = useMemo(() => (mineOnly ? refusals.filter((item) => item.actorId === viewer?.userId) : refusals), [refusals, mineOnly, viewer]);
  const nextDue = dueToday[0] ?? null;
  const selected = callbacks.find((item) => item.id === selectedId) ?? null;
  const selectedWindow = selected?.state ? windows[selected.state] : undefined;
  const current = selected ? localParts(selected.scheduledAtUtc, selected.customerTimezone) : null;
  const draftDate = draft && selected && draft.id === selected.id ? draft.date : current?.date ?? "";
  const draftTime = draft && selected && draft.id === selected.id ? draft.time : current?.time ?? "";
  const draftLocal = draftDate && draftTime ? `${draftDate}T${draftTime}` : "";
  const draftAt = selected && draftLocal ? zonedToUtc(draftLocal, selected.customerTimezone) : null;
  const [draftHour, draftMinute] = draftTime ? draftTime.split(":").map(Number) : [NaN, NaN];
  const inWindow = selectedWindow && Number.isFinite(draftHour) ? insideWindow(selectedWindow, draftHour, draftMinute) : null;
  const inFuture = draftAt ? draftAt.getTime() > now : null;
  const stateName = selected?.state ? STATE_NAMES[selected.state] ?? selected.state : null;
  const unchanged = Boolean(current && draftDate === current.date && draftTime === current.time);
  const terminal = selected ? TERMINAL_STATUSES.has(selected.status) : true;
  const canBook = Boolean(selected && !readOnly && !selected.isDemo && !terminal && !saving && inWindow !== false && inFuture === true && selected.state && !unchanged);
  const suggestion = nearest && selected && nearest.id === selected.id && nearest.local === draftLocal ? nearest.value : null;

  // "Outside the Oregon calling window" is answered with the next time that is not. Asked of the
  // server (next_callable_instant) so holidays, Sundays and the campaign are weighed too.
  const selectedLive = selected && !selected.isDemo && !terminal && !readOnly ? selected.id : null;
  useEffect(() => {
    if (!selectedLive || inWindow !== false || !draftLocal) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/app/callbacks?callback_id=${encodeURIComponent(selectedLive)}&suggest_local=${encodeURIComponent(draftLocal)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (body) setNearest({ id: selectedLive, local: draftLocal, value: (body.nearest ?? null) as NearestLegalTime | null }); })
        .catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [selectedLive, inWindow, draftLocal]);

  function choose(callback: CallbackView) {
    selectedIdRef.current = callback.id;
    setSelectedId(callback.id);
    setHistoryOpen(false);
    setDraft(null);
  }

  /** "Use that": the suggestion goes into the picker. The agent still books it. */
  function takeSuggestion(callback: CallbackView, value: NearestLegalTime) {
    choose(callback);
    const [date, time] = value.customerLocal.split("T");
    setDraft({ id: callback.id, date, time });
  }

  async function act(actionName: "reschedule" | "cancel" | "complete") {
    if (!selected) return;
    setSaving(true); setError("");
    const response = await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, callback_id: selected.id, callback_local: actionName === "reschedule" ? draftLocal : undefined }) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) {
      const message = body?.error ?? "Could not update the callback. Your choice is still on screen.";
      setError(message);
      notify.block(message);
      if (actionName === "reschedule" && body && "nearest" in body) setNearest({ id: selected.id, local: draftLocal, value: (body.nearest ?? null) as NearestLegalTime | null });
      return;
    }
    notify.done(actionName === "reschedule" ? "Callback booked" : actionName === "complete" ? "Callback marked done" : "Callback cancelled");
    setDraft(null);
    await load();
  }

  async function openHistory() {
    if (!selected || selected.isDemo) { setHistoryOpen((value) => !value); return; }
    if (historyOpen) { setHistoryOpen(false); return; }
    setHistoryOpen(true); setHistoryLoading(true);
    const response = await fetch(`/api/app/callbacks?callback_id=${encodeURIComponent(selected.id)}&include_history=true`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    const detail = response.ok ? (body?.callbacks ?? [])[0] as CallbackView | undefined : undefined;
    if (detail) setCallbacks((items) => items.map((item) => item.id === detail.id ? { ...item, history: detail.history } : item));
    setHistoryLoading(false);
  }

  if (loading) return <div className="m-stagger portal-callbacks-page portal-callbacks-state" role="status"><Loader2 className="size-4 animate-spin" />Loading callbacks…</div>;

  const rowProps = (callback: CallbackView) => ({ callback, now, callWindow: callback.state ? windows[callback.state] : undefined, yourZone, selected: callback.id === selectedId, readOnly, showAssignee: !mineOnly && callback.assignedTo !== viewer?.userId, onReschedule: () => choose(callback) });

  const scopeToggle = viewer && (
    <div role="group" aria-label="Whose callbacks" className="inline-flex gap-1">
      <Button type="button" size="sm" variant={scope === "mine" ? "default" : "outline"} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>Mine</Button>
      <Button type="button" size="sm" variant={scope === "all" ? "default" : "outline"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>All</Button>
    </div>
  );

  return (
    <main className="m-stagger portal-callbacks-page">
      <PageHeader
        title="Callbacks"
        description={"“Call me Thursday after 2” is the most common productive outcome. It is booked in her time, not yours — and it counts when the call comes back."}
        actions={<div className="flex flex-wrap items-center gap-2">{scopeToggle}<Button variant="outline" asChild><Link href="/app/dialer">Open the queue</Link></Button></div>}
      />
      {demoPreview && <div role="status" className="portal-callbacks-notice">Showing demo preview data because this workspace has no callbacks yet. These records are read-only and are not stored.</div>}
      {readOnly && <div role="status" className="portal-callbacks-notice">This account is suspended and read-only. You can still review callbacks.</div>}
      {error && <div role="alert" className="portal-callbacks-error"><CircleAlert className="size-4" aria-hidden="true" />{error}</div>}

      <div className="portal-callbacks-tiles">
        <StatTile label="Due today" value={dueToday.length} footnote={nextDue ? `next at ${shortTime(nextDue.scheduledAtUtc, nextDue.customerTimezone)}` : "nothing left today"} />
        <StatTile label="Overdue" value={overdue.length} valueTone={overdue.length ? "danger" : undefined} footnote="never dropped from the list" />
        <StatTile label="Kept rate" value={keptRate === null ? "—" : keptRate.toFixed(1)} unit={keptRate === null ? undefined : "%"} valueTone={keptRate === null ? undefined : "good"} footnote={`${kept} of ${kept + missed} last 30 days${keptByHand ? ` · ${keptByHand} marked by hand` : ""}`} />
        {isOwner && worstSource
          ? <StatTile label={`Kept rate — ${worstSource.name}`} value={worstSource.rate.toFixed(1)} unit="%" valueTone="warning" footnote={`lowest source · ${worstSource.kept} of ${worstSource.settled}`} />
          : <StatTile label="Open callbacks" value={open.length} footnote="scheduled, due or missed" />}
      </div>

      <div className="portal-callbacks-body">
        <div className="portal-callbacks-lists">
          {open.length === 0 && <section className="portal-callbacks-panel"><p className="portal-callbacks-empty">{mineOnly ? "You have no open callbacks. Choose All to see the rest of the workspace." : "No open callbacks. When an outcome books one, it appears here in the customer’s own time."}</p></section>}
          {overdue.length > 0 && (
            <Panel title="Overdue" count={overdue.length} chip={<Chip tone="error" dot={false}>stays here until it is called, rebooked or cancelled</Chip>}>
              {overdue.map((callback) => <CallbackRow key={callback.id} {...rowProps(callback)} />)}
            </Panel>
          )}
          {dueToday.length > 0 && <Panel title="Due today" count={dueToday.length}>{dueToday.map((callback) => <CallbackRow key={callback.id} {...rowProps(callback)} />)}</Panel>}
          {upcoming.length > 0 && <Panel title="Upcoming" count={upcoming.length}>{upcoming.map((callback) => <CallbackRow key={callback.id} {...rowProps(callback)} />)}</Panel>}
          {visibleRefusals.map((refusal) => {
            const asked = refusal.requestedLocal ? zonedToUtc(refusal.requestedLocal, refusal.timezone) : null;
            const openOne = callbacks.find((item) => item.leadId === refusal.leadId && OPEN_STATUSES.has(item.status) && !item.isDemo);
            return (
              <div key={refusal.id} className="portal-callbacks-note is-error" role="status">
                <strong>{refusal.customerName}&rsquo;s callback could not be booked{asked ? ` for ${shortTime(asked, refusal.timezone)}` : ""}</strong>
                <p>
                  {refusal.message}
                  {refusal.nearest && <> The nearest legal time is {longTime(refusal.nearest.utc, refusal.timezone)} their time, which is {shortTime(refusal.nearest.utc, yourZone, false)} yours.</>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {refusal.nearest && openOne && !readOnly && <Button type="button" size="sm" variant="outline" onClick={() => takeSuggestion(openOne, refusal.nearest as NearestLegalTime)}>Use that time</Button>}
                  <Link className="portal-callbacks-link" href={`/app/leads/${refusal.leadId}`}>Open lead</Link>
                </div>
              </div>
            );
          })}
          {settledRecent.length > 0 && (
            <details className="portal-callbacks-panel portal-callbacks-settled">
              <summary className="portal-callbacks-panel-bar"><h2>Settled in the last 30 days &mdash; {settledRecent.length}</h2></summary>
              {settledRecent.map((callback) => {
                const look = settledLabel(callback);
                return (
                  <div className="portal-callbacks-row" key={callback.id}>
                    <span className="portal-callbacks-who"><strong>{callback.customerName}</strong><small>{[callback.phone, callback.sourceName].filter(Boolean).join(" · ")}</small></span>
                    <span className="portal-callbacks-when"><strong>{longTime(callback.scheduledAtUtc, callback.customerTimezone)}</strong><small>{shortTime(callback.scheduledAtUtc, yourZone, false)} your time</small></span>
                    <Chip tone={look.tone}>{look.label}</Chip>
                    <span className="portal-callbacks-actions">{!callback.isDemo && <Link className="portal-callbacks-link" href={`/app/leads/${callback.leadId}`}>Open lead</Link>}</span>
                  </div>
                );
              })}
            </details>
          )}
        </div>

        <aside className="portal-callbacks-side">
          {selected ? (
            <section className="portal-callbacks-card" aria-labelledby="book-callback-heading">
              <h2 id="book-callback-heading">Book a callback</h2>
              <p className="portal-callbacks-card-sub">
                {selected.customerName}{stateName ? ` · ${stateName}` : ""}
                {!selected.isDemo && <> · <Link href={`/app/leads/${selected.leadId}`}>Open lead <ExternalLink className="inline size-3.5" aria-hidden="true" /></Link></>}
              </p>
              <div className="portal-callbacks-local">
                <span>Their local time</span>
                <strong>{draftAt ? longTime(draftAt, selected.customerTimezone) : "Choose a date and time"}</strong>
                <small>{draftAt ? `${shortTime(draftAt, yourZone, false)} your time (${zoneAbbreviation(yourZone, draftAt)})` : " "}</small>
              </div>
              <div className="portal-callbacks-fields">
                <label><span>Date</span><input type="date" value={draftDate} disabled={readOnly || selected.isDemo || terminal} onChange={(event) => setDraft({ id: selected.id, date: event.target.value, time: draftTime })} /></label>
                <label><span>Time &mdash; their timezone</span><input type="time" value={draftTime} disabled={readOnly || selected.isDemo || terminal} onChange={(event) => setDraft({ id: selected.id, date: draftDate, time: event.target.value })} /></label>
              </div>
              <div className="portal-callbacks-checks">
                <span>
                  {!selected.state
                    ? <Chip tone="warning">No state on this lead</Chip>
                    : inWindow === null ? <Chip tone="neutral">Window not loaded</Chip>
                    : inWindow ? <Chip tone="success">Inside the {stateName} calling window</Chip>
                    : <Chip tone="error">Outside the {stateName} calling window</Chip>}
                  <small>{!selected.state ? "Add the state to the lead first; its calling window decides when it may be called." : selectedWindow ? windowSummary(selectedWindow) : "The server still checks it before booking."}</small>
                </span>
                {suggestion && (
                  <span>
                    <small className="text-[var(--body)]">Nearest legal time: <strong className="font-semibold text-[var(--ink)]">{longTime(suggestion.utc, selected.customerTimezone)}</strong> their time &mdash; {shortTime(suggestion.utc, yourZone, false)} yours</small>
                    <Button type="button" size="sm" variant="outline" onClick={() => takeSuggestion(selected, suggestion)}>Use that</Button>
                  </span>
                )}
                <span>
                  {inFuture === null ? <Chip tone="neutral">Choose a time</Chip> : inFuture ? <Chip tone="success">In the future</Chip> : <Chip tone="error">In the past</Chip>}
                  <small>A time in the past is refused, not accepted and hidden</small>
                </span>
              </div>
              <Button type="button" className="w-full" disabled={!canBook} onClick={() => void act("reschedule")}>{saving ? "Booking…" : "Book the callback"}</Button>
              {!terminal && !selected.isDemo && !readOnly && (
                <div className="portal-callbacks-card-more">
                  <button type="button" disabled={saving} onClick={() => void act("complete")} title="Records it as kept by hand. Where the lead goes next is the call's outcome, not this button.">Mark done</button>
                  <button type="button" disabled={saving} onClick={() => void act("cancel")}>Cancel callback</button>
                  <button type="button" aria-expanded={historyOpen} onClick={() => void openHistory()}>History</button>
                </div>
              )}
              {historyOpen && (
                historyLoading ? <p className="portal-callbacks-history-note" role="status">Loading history…</p>
                  : selected.history.length === 0 ? <p className="portal-callbacks-history-note">No history recorded yet.</p>
                  : <ol className="portal-callbacks-history">{[...selected.history].reverse().map((entry) => <li key={entry.id}><strong>{longTime(entry.createdAt, yourZone)}</strong><span>{entry.action.replaceAll("_", " ")}{entry.via === "manual" ? " by hand" : entry.via === "call" ? " on the call" : ""} · {entry.actorName}</span>{entry.note && <small>{entry.note}</small>}</li>)}</ol>
              )}
            </section>
          ) : (
            <section className="portal-callbacks-card"><h2>Book a callback</h2><p className="portal-callbacks-card-sub">Choose Reschedule on any callback to move it to a new time in the customer&rsquo;s own timezone.</p></section>
          )}
          {isOwner && sourceRates.length > 0 && (
            <section className="portal-callbacks-card" aria-labelledby="source-kept-heading">
              <h2 id="source-kept-heading">Kept rate by source</h2>
              <p className="portal-callbacks-card-sub">Of callbacks settled in the last 30 days, how many came back. Visible to owners.</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {sourceRates.map((entry) => (
                  <li key={entry.name} className="flex items-baseline justify-between gap-3 text-sm leading-normal">
                    <span className="min-w-0 truncate font-semibold text-[var(--ink)]">{entry.name}</span>
                    <span className="shrink-0 tabular-nums text-[var(--body)]">
                      <strong className={`font-semibold ${worstSource?.name === entry.name ? "text-[var(--error-ink)]" : "text-[var(--ink)]"}`}>{entry.rate.toFixed(0)}%</strong>
                      <span className="ml-2 text-xs text-[var(--muted)]">{entry.kept} of {entry.settled}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {worstSource && <p className="m-0 text-sm leading-normal text-[var(--body)]">{worstSource.name}&rsquo;s callbacks are kept least often. A callback booked to end an awkward call is a transfer that did not qualify.</p>}
              {!worstSource && <p className="m-0 text-xs leading-normal text-[var(--muted)]">A lowest source is named once two sources each have {MIN_SOURCE_SAMPLE} settled callbacks.</p>}
            </section>
          )}
          <div className="portal-callbacks-note is-error">
            <strong>3:00 am is refused, and says why</strong>
            <p>{selectedWindow && stateName ? `${stateName}’s window closes at ${hourLabel(selectedWindow.effective.end)}.` : "Every state has a calling window."} The picker will not accept it and the API will not store it &mdash; the shape of the input was never the problem, the legality of the time was.</p>
          </div>
          <div className="portal-callbacks-note is-info">
            <strong>Two timezones on one row, always labelled</strong>
            <p>Their time on top in the strong weight, yours beneath in muted. A callback missed because of a timezone is the exact failure this page exists to prevent, so neither number is ever left to be guessed at.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
