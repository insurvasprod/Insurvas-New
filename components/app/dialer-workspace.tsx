"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notify, setCallInProgress } from "@/lib/notify";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Callout, DashedCard, Pill, SettingsCard, btn, control, st, type PillTone } from "@/components/app/settings/primitives";
import { DialerPreflightDialog } from "@/components/app/dialer-preflight";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { sectionForPath } from "@/lib/menu/definition";
import { openSlots, zonedInstant, type PickerContext } from "@/lib/appointments/calendarMath";
import { insideWindow, STATE_NAMES, windowSummary, type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { productLineLabel } from "@/lib/format/productLine";
import { agoLabel } from "@/lib/format/ago";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import {
  attemptOfCeiling,
  consentLabel,
  costPerLeadLabel,
  formatUsPhone,
  localClock,
  minuteLabel,
  priorityForTier,
  returnWindowLine,
  selectionReasonParts,
  shortDate,
  slotLabel,
  slotsTried,
  sourceLabel,
  SUPPRESSION_LISTS,
  windowClosedLabel,
  zoneShort,
  type QueuePriority,
  type ReturnWindow,
} from "@/lib/dialerScripts/display";

type Lead = { id: string; product_line?: string; values: Record<string, unknown> };
type Eligibility = {
  allowed: boolean;
  reason: string;
  message: string;
  checkedAt: string;
  timezone: string | null;
  customerLocalTime: string | null;
  /** Vendor availability, not a lookup of this number. See lib/dialerScripts/service.ts. */
  dncCheck: "pending" | "clear" | "suppressed" | "unavailable";
  suppression?: "clear" | "suppressed" | "unavailable" | "not_checked";
  /** Every stored list the number is on (20260925700200); null when only the agency's list could be read. */
  suppressionHits?: Array<{ listType: string; reason: string; addedAt: string | null }> | null;
  licence?: { status: "live" | "refused" | "unavailable"; state: string; expiresAt: string | null; message: string | null } | null;
};
type Consent = { available: boolean; hasCertificate: boolean; provider: string | null; status: string | null; capturedAt: string | null; consentTimestamp: string | null; ageDays: number | null };
type AttemptHistory = { id: string; attemptNumber: number; attemptedAt: string; slot: string; disposition: string | null; dialClicked: boolean; disclosureConfirmed: boolean };
type Panel = {
  lead: { id: string; firstName: string; fullName?: string; state: string; age: string; phone: string; campaignId: string | null; productCode: string; workItemId: string | null; attemptsMade?: number; leadState?: string | null; nextDialAfter?: string | null; nextSlot?: string | null; attemptCeiling?: number | null };
  recycle?: { angle: string; script: string | null; attemptCeiling: number | null; recycledAt: string | null } | null;
  viewerUserId?: string | null;
  campaign?: { name: string | null; vendorName: string | null; leadType: string | null; costPerLeadCents?: number | null; scrubStatus?: string | null; scrubbedAt?: string | null } | null;
  returnWindow?: ReturnWindow | null;
  callbackWindow?: CallbackWindowFacts | null;
  window?: { allowed: boolean; startMinute: number | null; endMinute: number | null; zone: string | null; reason: string } | null;
  lastDncCheck?: { result: string; checkedAt: string } | null;
  script: { id: string | null; version: number; campaignId: string | null; productCode: string; sections: Record<string, unknown> };
  rebuttals: Array<{ id: string; objectionKey: string; label: string; body: string }>;
  disclosure: { id: string | null; state: string; productCode: string; requiredText: string; configured: boolean; blocking: boolean };
  eligibility: Eligibility;
  selectionReason: string | null;
  consent: Consent;
  attemptHistory: AttemptHistory[];
};
type Attempt = { id: string; attempt_number?: number };
type Served = { leadId: string; workItemId?: string; tier: number; tierName: string; selectionReason: string | null; appointmentNotes: string | null; lockedUntil: string };
type QueueRow = { workItemId: string; leadId: string; tier: number; tierName: string; name: string | null; state: string | null; attemptsMade: number; assignedToYou: boolean; localTime: string | null };
type Stats = { dials: number; contacts: number; contactRate: number | null; since: string; zone: string };
type Queue = ({ available: true; count: number; capped: boolean; cap: number; rows: QueueRow[] } | { available: false; message: string }) & { stats?: Stats | null };
type QueueFilter = "all" | "high" | "medium" | "low";

/**
 * The outbound outcomes, in the order they render — which is the order keys 1–8 pick them.
 *
 * The board's four first (No answer, Callback, Not interested, Application). Its fifth, "Contacted",
 * is not here: the call engine has no "contacted" outcome, and a button that recorded one would go
 * down the cadence branch as if it were a retry — a contact counted as a miss. The three outcomes
 * that drive the cadence differently (voicemail, busy, a dropped call) follow under "More
 * outcomes", with Do not call, which is confirmed before it is recorded.
 */
// Wrong number and Disconnected (user decision 2026-09-25) follow Do not call, so the keys that
// already existed keep their numbers.
const OUTBOUND_DISPOSITIONS = ["no_answer", "callback_scheduled", "not_interested", "application_submitted", "voicemail", "busy", "call_dropped", "do_not_call", "wrong_number", "disconnected"];
/** Outcomes that can send the lead back to its vendor; confirmed with the return window first. */
const RETURNABLE = new Set(["wrong_number", "disconnected"]);
// Deliberately NOT in the list above. An inbound return call is the customer's call, not one of
// Ray's seven attempts, so it is offered only on the search path and recorded without touching the
// cadence (decision 1).
const INBOUND_DISPOSITION = "inbound_return_call";
const DISPOSITION_LABELS: Record<string, string> = {
  no_answer: "No answer",
  callback_scheduled: "Callback",
  not_interested: "Not interested",
  application_submitted: "Application",
  voicemail: "Voicemail",
  busy: "Busy",
  call_dropped: "Call dropped",
  do_not_call: "Do not call",
  wrong_number: "Wrong number",
  disconnected: "Disconnected",
  inbound_return_call: "Inbound return call",
};
const scriptSections = ["opening", "qualifying_questions", "transition_to_quote", "close"];
const SECTION_LABELS: Record<string, string> = { opening: "Opening", qualifying_questions: "Qualifying questions", transition_to_quote: "Transition to quote", close: "Close" };
const PRIORITY_TONE: Record<QueuePriority, PillTone> = { High: "error", Medium: "warning", Low: "neutral" };
const FILTERS: Array<{ key: QueueFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "high", label: "High" },
  { key: "medium", label: "Med" },
  { key: "low", label: "Low" },
];

const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]";
const h2 = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";
const label = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const value = "mt-1 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums break-words";
const small = "text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";
const body14 = "text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const barHead = "flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3";
const barTitle = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";

function errorText(body: unknown, fallback: string) {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

/** A `datetime-local` value read in `zone` as a UTC instant, or null. */
function instantInZone(local: string, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]), zone);
}

/** A slot as the booking list reads it: the customer's time first, then "= your time". */
function slotOptionLabel(iso: string, customerZone: string | null): string {
  const yours = `${localClock(iso, viewerTimeZone())} your time`;
  if (!customerZone) return `${dateTime(iso, viewerTimeZone(), { weekday: true, clock: "12h" })} your time`;
  return `${dateTime(iso, customerZone, { weekday: true, clock: "12h" })} ${zoneShort(customerZone)} = ${yours}`;
}

/**
 * The toast after a disposition, with the server's own sentence for what happens next ("Attempt 4
 * scheduled for Thu 26 Sep 14:00 in the afternoon slot.", "Closed. Claimable from …") from
 * complete_existing_dial_disposition.
 */
function announceDisposition(value: string, body: { attempt?: unknown } | null) {
  const attempt = body?.attempt as { reason?: unknown; scheduled_at_utc?: unknown } | Array<{ reason?: unknown }> | undefined;
  const recorded = Array.isArray(attempt) ? attempt[0] : attempt;
  const nextStep = typeof recorded?.reason === "string" && recorded.reason ? recorded.reason : undefined;
  const callbackAt = !Array.isArray(attempt) && typeof attempt?.scheduled_at_utc === "string" ? attempt.scheduled_at_utc : null;
  if (value === "application_submitted") { if (nextStep) notify.win("Application submitted", { detail: nextStep }); else notify.win("Application submitted"); }
  else if (value === "callback_scheduled" && callbackAt) notify.done("Callback booked", { detail: `For ${new Date(callbackAt).toLocaleString()}.` });
  else notify.done("Disposition recorded", { detail: nextStep });
}

function leadName(values: Record<string, unknown>) {
  const composed = [values.first_name, values.last_name].filter(Boolean).join(" ");
  return String(values.full_name ?? values.name ?? (composed || "Unnamed lead"));
}

export function DialerWorkspace({ readOnly = false, role = "producer", canCheckNumber = false, requestedLeadId = null }: { readOnly?: boolean; role?: string; canCheckNumber?: boolean; requestedLeadId?: string | null }) {
  // LA-2.12. A setter works this queue but may not sell, quote or submit an application, and may
  // not "see other setters' leads" — so identity search is not theirs either. Both controls are
  // withheld rather than shown-and-refused: the routes behind them already answer 403, and an
  // offered control that always fails is the dead end this audit keeps removing.
  const isSetter = role === "setter";
  // Scripts and rebuttals are agency-wide; publishing them is an owner's or producer's call.
  const canAuthor = !readOnly && !isSetter;
  const dispositions = useMemo(() => (isSetter ? OUTBOUND_DISPOSITIONS.filter((key) => key !== "application_submitted") : OUTBOUND_DISPOSITIONS), [isSetter]);
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(!readOnly);
  const [working, setWorking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dialled, setDialled] = useState(false);
  const [rebuttal, setRebuttal] = useState<string | null>(null);
  const [editingScript, setEditingScript] = useState(false);
  const [draftSections, setDraftSections] = useState<Record<string, string>>({});
  const [panelReload, setPanelReload] = useState(0);
  // What the server served (or the agent picked, through the server) and why.
  const [served, setServed] = useState<Served | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [serving, setServing] = useState(false);
  // The Priority queue list (user decision 2026-09-24): a bounded, read-only preview of what is
  // servable to this agent now. Picking a row is a serve of that lead, refused with a reason when
  // any gate says no.
  const [queue, setQueue] = useState<Queue | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [queueReload, setQueueReload] = useState(0);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickRefusals, setPickRefusals] = useState<Record<string, string>>({});
  // LA-2.12's booking workflow: "setter dials → qualifies → books a slot on Ray's calendar". The
  // picker proposes times from the same hours, blocks, same-day switch, buffer, double-booking and
  // linked busy time `book_appointment` enforces. The server still decides.
  const [calendar, setCalendar] = useState<(Partial<PickerContext> & { agents: Array<{ userId: string; name: string; timezone: string | null }> }) | null>(null);
  const [calendarAt, setCalendarAt] = useState(0);
  const [bookAgent, setBookAgent] = useState("");
  // Appointments audit (2026-09-25): the booking is slot-only — the agent picks one of the open
  // slots, as UTC instants, soonest first. The server still accepts any valid time from other
  // callers and re-checks every rule; the screen just stops offering an off-grid one.
  const suggestedSlots = useMemo(() => {
    if (!calendar?.availability || !bookAgent || !calendarAt) return [];
    const context: PickerContext = { availability: calendar.availability, blocks: calendar.blocks ?? [], policy: calendar.policy ?? [], upcoming: calendar.upcoming ?? [], busy: calendar.busy ?? [] };
    return openSlots(context, bookAgent, calendarAt, { days: 7, limit: 12 });
  }, [calendar, bookAgent, calendarAt]);
  // `callback_scheduled` opens this, and the disposition is not sent until there is a time.
  const [pendingCallback, setPendingCallback] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  // Do not call is permanent (the number joins the agency's internal list), so it asks first.
  const [pendingDnc, setPendingDnc] = useState(false);
  // Wrong number / Disconnected close the lead and may send it back to the vendor: confirmed first,
  // with the return window's answer on screen.
  const [pendingReturn, setPendingReturn] = useState<string | null>(null);
  const [bookSlot, setBookSlot] = useState("");
  const [bookNotes, setBookNotes] = useState("");
  const [booking, setBooking] = useState(false);
  // LA-2.14 · "Interested — start application".
  const [starting, setStarting] = useState(false);
  // The two overlays: the ad-hoc number check, and the structured call outcome for a served lead.
  const [checkOpen, setCheckOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  // A refused disposition, shown in the Disposition card (e.g. an application before verification is complete).
  const [dispositionError, setDispositionError] = useState<string | null>(null);

  // Decided 2026-09-23: no sound while a call is open, except a compliance block.
  useEffect(() => {
    setCallInProgress(Boolean(attempt));
    return () => setCallInProgress(false);
  }, [attempt]);

  // The first lead is SERVED by the server, never the first row of a list. A "Call now" link
  // (?lead=…) opens that lead instead, through the pick — the same gates as any pick — and a refusal
  // is shown as the pick's own sentence; nothing else is served in its place.
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    if (requestedLeadId) {
      void fetch("/api/app/dialer/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: requestedLeadId }) }).then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (response.ok && body?.served) { setServed(body.served); setSelectedId(body.served.leadId); }
        else setEmptyReason(`That lead could not be opened: ${errorText(body, "the server refused it.")} Press Serve next lead for the next one in the queue.`);
        setQueueReload((n) => n + 1);
      }).catch(() => { if (active) setEmptyReason("That lead could not be opened. Press Serve next lead for the next one in the queue."); }).finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }
    void fetch("/api/app/dialer/next", { method: "POST" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not serve a lead"));
      if (!active) return;
      if (body.served) { setServed(body.served); setSelectedId(body.served.leadId); }
      else setEmptyReason(body.emptyReason ?? "Nothing is servable right now.");
      setQueueReload((n) => n + 1);
    }).catch((error) => { if (active) notify.fail("Could not serve a lead", { detail: error instanceof Error ? error.message : undefined }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [readOnly, requestedLeadId]);

  // The list. Read-only on the server, so it loads for read-only accounts too.
  useEffect(() => {
    let active = true;
    void fetch(`/api/app/dialer/queue?priority=${queueFilter}`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!active) return;
      if (!response.ok) { setQueueError(errorText(body, "Could not load the queue")); return; }
      setQueue(body as Queue);
      setQueueError(null);
    }).catch(() => { if (active) setQueueError("Could not load the queue"); });
    return () => { active = false; };
  }, [queueFilter, queueReload]);

  useEffect(() => {
    let active = true;
    void fetch("/api/app/appointments", { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok || !active) return;
      setCalendar(body);
      setCalendarAt(Date.now());
      if (body.agents?.[0]) setBookAgent(body.agents[0].userId);
    }).catch(() => { /* the booking panel is optional; a dialer without it still works */ });
    return () => { active = false; };
  }, []);

  /**
   * Book the qualified lead onto an agent's calendar. The server owns every rule — the customer's
   * legal window at the booked instant, working hours, blocked time, the daily cap and the slot race.
   */
  async function bookAppointment() {
    if (!panel || !bookAgent || !bookSlot || booking) return;
    setBooking(true);
    try {
      const response = await fetch("/api/app/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: panel.lead.id, agent_user_id: bookAgent, starts_at_utc: bookSlot, notes: bookNotes.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block("Could not book the appointment", { detail: errorText(body, "The server refused the slot.") }); return; }
      notify.win("Appointment booked", { detail: body.appointment?.reason ?? undefined });
      setBookSlot(""); setBookNotes("");
    } catch { notify.fail("Could not book the appointment"); }
    finally { setBooking(false); }
  }

  /**
   * LA-2.14 · "Interested — start application". Opens the SAME verification panel an inbound
   * transfer opens; the lead carries its campaign through.
   */
  async function startApplication() {
    if (!panel || readOnly || starting || !panel.lead.workItemId) return;
    setStarting(true);
    try {
      const response = await fetch("/api/app/outbound/application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_item_id: panel.lead.workItemId, product_line: panel.lead.productCode || undefined }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block("Could not start the application", { detail: errorText(body, "The server refused it.") }); return; }
      notify.win("Application started", { detail: "Everything collected so far is saved — a dropped call resumes here." });
      router.push(`/app/leads/${panel.lead.id}`);
    } catch { notify.fail("Could not start the application"); }
    finally { setStarting(false); }
  }

  /**
   * Keyboard-only operation for the whole loop — LA-2.9 criterion 6. `n` serves the next lead, `d`
   * starts the call, and the number keys pick a disposition in the order they are rendered.
   * Guarded on the event target, so typing a script edit or a search never fires one.
   */
  useEffect(() => {
    if (readOnly) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // An open overlay owns the keyboard: a "1" typed in it must not record an outcome behind it.
      if (checkOpen || outcomeOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); void serveNext(); return; }
      if (key === "d") { event.preventDefault(); void dial(); return; }
      const index = Number(event.key);
      // Digit keys reach the first nine; a tenth outcome (Disconnected, for an owner or producer) is a click.
      if (!searchMode && Number.isInteger(index) && index >= 1 && index <= dispositions.length) {
        event.preventDefault();
        choose(dispositions[index - 1]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void fetch(`/api/app/dialer/panel?lead_id=${encodeURIComponent(selectedId)}`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not load call guidance"));
      if (!active) return;
      const nextPanel = body as Panel;
      setPanel(nextPanel);
      setPanelError(null);
      setDraftSections(Object.fromEntries(scriptSections.map((key) => [key, String(nextPanel.script.sections[key] ?? "")])));
    }).catch((error) => {
      if (!active) return;
      setPanel(null);
      setPanelError(error instanceof Error ? error.message : "Could not load call guidance");
    });
    return () => { active = false; };
  }, [selectedId, panelReload]);

  const resetCall = useCallback(() => {
    setAttempt(null); setConfirmed(false); setDialled(false); setRebuttal(null); setEditingScript(false); setPendingCallback(false); setCallbackAt(""); setPendingDnc(false); setPendingReturn(null); setDispositionError(null);
  }, []);

  function selectLead(id: string) {
    setPanel(null); setPanelError(null); resetCall(); setSelectedId(id);
  }

  async function searchLeads(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    if (query.length < 2) { notify.block("Enter at least two characters to search leads"); return; }
    setSearching(true);
    try {
      const response = await fetch(`/api/app/dialer/search?q=${encodeURIComponent(query)}&limit=40`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not search leads"));
      setLeads((body?.leads ?? []) as Lead[]);
      setSearchMode(true);
      setSelectedId(""); setPanel(null); setPanelError(null); resetCall();
    } catch (error) { notify.fail("Could not search leads", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setSearching(false); }
  }

  function clearLeadSearch() {
    setSearch(""); setSearchMode(false); setLeads([]); setPanel(null); setPanelError(null); resetCall();
    // Back to the lead the queue served, if the agent still holds one.
    setSelectedId(served?.leadId ?? "");
    setQueueReload((n) => n + 1);
  }

  const visibleLeads = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return leads.filter((lead) => !needle || Object.values(lead.values).some((v) => String(v ?? "").toLocaleLowerCase().includes(needle))).slice(0, 40);
  }, [leads, search]);

  async function saveCurrentScript() {
    if (!panel || !canAuthor) return;
    setWorking(true);
    try {
      const response = await fetch("/api/app/dialer/scripts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaign_id: panel.script.campaignId, product_code: panel.script.productCode, sections: draftSections }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not save script"));
      setEditingScript(false); setPanelReload((n) => n + 1); notify.done("New script version saved", { detail: "It applies to the next lead." });
    } catch (error) { notify.fail("Could not save the script", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setWorking(false); }
  }

  /**
   * Ask the server for the next lead. Everything about ordering happens inside `serve_next_lead`:
   * the tiers, the cadence timer, slot rotation, campaign mixing and the score — and, since
   * 2026-09-24, the agent's own assigned leads in that same order.
   */
  async function serveNext() {
    if (readOnly || serving || attempt) return;
    await serveNextNow();
  }

  /** The serve itself, without the open-call guard: the call-outcome dialog closes the call first. */
  async function serveNextNow() {
    setServing(true);
    try {
      const response = await fetch("/api/app/dialer/next", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not serve the next lead"));
      resetCall();
      setQueueReload((n) => n + 1);
      if (!body.served) {
        // An empty queue is a normal state, not a failure. The server supplies the wording.
        setServed(null); setSelectedId(""); setPanel(null); setPanelError(null);
        setEmptyReason(body.emptyReason ?? "Nothing is servable right now.");
        return;
      }
      setEmptyReason(null);
      setServed(body.served);
      setSearchMode(false);
      selectLead(body.served.leadId);
    } catch (error) { notify.fail("Could not serve the next lead", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setServing(false); }
  }

  /**
   * The agent chose a row. This is a serve of THAT lead, through the server: the same gates and the
   * same lock as Serve next, and a refusal that names the rule, shown in the row.
   */
  async function pickLead(row: QueueRow) {
    if (readOnly || attempt || picking) return;
    setPicking(row.workItemId);
    setPickRefusals((current) => { const next = { ...current }; delete next[row.workItemId]; return next; });
    try {
      const response = await fetch("/api/app/dialer/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: row.workItemId }) });
      const body = await response.json().catch(() => null);
      if (response.status === 409) { setPickRefusals((current) => ({ ...current, [row.workItemId]: errorText(body, "The server refused this pick.") })); return; }
      if (!response.ok) throw new Error(errorText(body, "Could not serve that lead"));
      setEmptyReason(null);
      setServed(body.served);
      setSearchMode(false);
      selectLead(body.served.leadId);
      setQueueReload((n) => n + 1);
    } catch (error) { notify.fail("Could not serve that lead", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setPicking(null); }
  }

  /**
   * `inbound` is the call the customer started (decision 1): found through search, no claim, no
   * cadence attempt. Every server gate still applies to it.
   */
  async function prepareAttempt(inbound = false) {
    if (!panel || panel.disclosure.blocking || !panel.eligibility.allowed || readOnly) return;
    if (!inbound && !panel.lead.workItemId) return;
    setWorking(true);
    try {
      const response = await fetch("/api/app/dialer/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: panel.lead.id, script_id: panel.script.id, script_version: panel.script.version || null, disclosure_state: panel.lead.state, disclosure_product_code: panel.lead.productCode, ...(inbound ? { inbound: true } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not prepare call"));
      setAttempt(body.attempt); notify.done("Call attempt prepared", { detail: "Read the required disclosure, then start the call." });
    } catch (error) { notify.fail("Could not prepare the call", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setWorking(false); }
  }

  async function confirmRead() {
    if (!panel || !attempt || readOnly) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/app/dialer/attempt/${attempt.id}/disclosure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: panel.disclosure.state, product_code: panel.disclosure.productCode }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not record disclosure confirmation"));
      setConfirmed(true); notify.done("Disclosure recorded on this attempt");
    } catch (error) { notify.fail("Could not record the disclosure", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setWorking(false); }
  }

  async function dial() {
    if (!attempt || !confirmed || !panel || working || dialled) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/app/dialer/attempt/${attempt.id}/click`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Dialing was blocked by the compliance checks"));
      setDialled(true);
      window.location.href = `tel:${panel.lead.phone}`;
    } catch (error) { notify.block("Dialing is blocked", { detail: error instanceof Error ? error.message : "The compliance checks refused this number." }); }
    finally { setWorking(false); setPanelReload((n) => n + 1); }
  }

  /** A button or key press: some outcomes ask one more question before they are sent. */
  function choose(value: string) {
    if (!attempt || !dialled || working) return;
    if (!RETURNABLE.has(value)) setPendingReturn(null);
    if (value === "callback_scheduled") { setPendingDnc(false); setPendingCallback(true); return; }
    if (value === "do_not_call") { setPendingCallback(false); setPendingDnc(true); return; }
    if (RETURNABLE.has(value)) { setPendingCallback(false); setPendingDnc(false); setPendingReturn(value); return; }
    void disposition(value);
  }

  async function disposition(value: string, extra: Record<string, unknown> = {}) {
    if (!attempt || !dialled || working) return;
    setWorking(true); setDispositionError(null);
    try {
      const response = await fetch(`/api/app/dialer/attempt/${attempt.id}/disposition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disposition: value, ...extra }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(body, "Could not record disposition"));
      announceDisposition(value, body);
      resetCall();
      // "After a disposition — the next lead appears immediately." A search-opened lead stays open.
      // serveNextNow, not serveNext: resetCall's state has not landed in this closure yet, so
      // serveNext would still see the call it just closed and quietly serve nothing.
      if (searchMode) setPanelReload((n) => n + 1);
      else await serveNextNow();
    } catch (error) { setDispositionError(error instanceof Error ? error.message : "Could not record the disposition"); notify.fail("Could not record the disposition", { detail: error instanceof Error ? error.message : undefined }); }
    finally { setWorking(false); }
  }

  const loadingPanel = Boolean(selectedId && !panel && !panelError);
  const eligibility = panel?.eligibility;
  const outcomes = (searchMode ? [INBOUND_DISPOSITION] : dispositions);
  const primaryCount = isSetter ? 3 : 4;
  const blockers = panel
    ? [
        !panel.eligibility.allowed ? panel.eligibility.message : null,
        panel.disclosure.blocking ? `Dialing is blocked until Compliance publishes the approved ${productLineLabel(panel.disclosure.productCode).toLowerCase()} disclosure for ${panel.disclosure.state || "this lead's state"}.` : null,
        !searchMode && !panel.lead.workItemId ? "Claim this lead from the work queue before preparing a call." : null,
      ].filter((line): line is string => Boolean(line))
    : [];
  const callReady = blockers.length === 0;
  const stats = queue?.stats ?? null;
  const customerZone = eligibility?.timezone ?? null;
  const slotFacts = panel ? slotsTried(panel.attemptHistory) : null;
  const reasonParts = selectionReasonParts(served && panel && served.leadId === panel.lead.id ? served.selectionReason : panel?.selectionReason);
  // The callback being typed, as the customer's instant — for the "= your time" line, the window
  // and future chips, and the clash with the agent's own appointments. Advisory; the server decides.
  const callbackInstant = callbackAt && customerZone ? instantInZone(callbackAt, customerZone) : null;
  const callbackWindow = panel?.callbackWindow ?? null;
  const callbackInWindow = (() => {
    if (!callbackWindow || !callbackAt) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(callbackAt);
    if (!m) return null;
    if (callbackWindow.noSunday && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() === 0) return false;
    return insideWindow(callbackWindow, Number(m[4]), Number(m[5]));
  })();
  const callbackInFuture = callbackInstant === null ? null : callbackInstant > Date.now();
  const callbackClash = callbackInstant === null || !panel?.viewerUserId
    ? null
    : (calendar?.upcoming ?? []).find((row) => {
        if (row.agentUserId !== panel.viewerUserId || (row.status !== "booked" && row.status !== "confirmed")) return false;
        const start = Date.parse(row.startsAtUtc);
        return Number.isFinite(start) && callbackInstant >= start && callbackInstant < start + (row.durationMinutes || 30) * 60_000;
      }) ?? null;
  const stateName = panel?.lead.state ? STATE_NAMES[panel.lead.state] ?? panel.lead.state : null;
  const stackHits = eligibility?.suppressionHits ?? null;
  const bookableSlots = suggestedSlots.filter((iso) => {
    if (!callbackWindow || !customerZone) return true;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: customerZone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(iso));
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
    if (callbackWindow.noSunday && parts.find((part) => part.type === "weekday")?.value === "Sun") return false;
    return Number.isFinite(hour) && Number.isFinite(minute) ? insideWindow(callbackWindow, hour, minute) : true;
  });
  const campaignLine = panel?.campaign
    ? [
        typeof panel.campaign.costPerLeadCents === "number" ? `Cost per lead ${costPerLeadLabel(panel.campaign.costPerLeadCents)}, after vendor credits` : null,
        panel.campaign.scrubStatus === "scrubbed" && panel.campaign.scrubbedAt
          ? `Scrubbed ${shortDate(panel.campaign.scrubbedAt)}`
          : panel.campaign.scrubStatus && panel.campaign.scrubStatus !== "scrubbed" ? `Campaign scrub: ${panel.campaign.scrubStatus}` : null,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow={sectionForPath("/app/dialer") ?? undefined}
        title="Dialer"
        description="Serve the next scored lead, place a compliant call, record what happened."
        actions={canCheckNumber || !readOnly ? (
          <span className="flex flex-wrap items-center gap-3">
            {/* Owners and producers (sales.use), as the check route admits; a setter dials what the queue serves. */}
            {canCheckNumber && <button type="button" onClick={() => setCheckOpen(true)} className={btn("secondary", "h-11")}>Check a number</button>}
            {!readOnly && <button type="button" onClick={() => void serveNext()} disabled={serving || Boolean(attempt)} title={attempt ? "Finish this call first" : undefined} className={btn("secondary", "h-11")}>
              {serving ? "Serving…" : "Serve next lead"}
            </button>}
          </span>
        ) : null}
      />
      {canCheckNumber && <DialerPreflightDialog open={checkOpen} onOpenChange={setCheckOpen} readOnly={readOnly} />}

      {readOnly && <Callout tone="info" title="Read-only access">Review guidance and compliance evidence without starting or changing a call.</Callout>}

      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start">
        {/* ── left: the queue ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 lg:w-[300px] lg:shrink-0">
          <section className={cn(card, "flex flex-col overflow-hidden")} aria-label={searchMode ? "Search results" : "Priority queue"}>
            <div className={barHead}>
              <span className={barTitle}>{searchMode ? "Search results" : "Priority queue"}</span>
              <span className={cn(small, "tabular-nums")} title={searchMode ? undefined : "Leads servable to you right now, counted up to 1,000"}>
                {searchMode ? visibleLeads.length : queue?.available ? (queue.capped ? `${queue.cap.toLocaleString()}+` : queue.count.toLocaleString()) : ""}
              </span>
            </div>
            {searchMode ? (
              <div className="border-b border-[var(--border)] px-3 py-2.5">
                <p className={small}>Search results are read-only; opening one does not serve or claim the lead, and does not use a cadence attempt. A customer who rang you back is logged from the lead card.</p>
                <button type="button" onClick={clearLeadSearch} className={btn("secondary", "mt-2 h-[30px]")}>Back to queue</button>
              </div>
            ) : (
              <div className="border-b border-[var(--border)] px-3 py-2.5">
                <span className="flex gap-1.5" role="group" aria-label="Filter the queue by priority">
                  {FILTERS.map((filter) => (
                    <button key={filter.key} type="button" onClick={() => setQueueFilter(filter.key)} aria-pressed={queueFilter === filter.key} className={btn("secondary", cn("h-[30px] px-4", queueFilter === filter.key && "bg-[var(--surface-alt)]"))}>
                      {filter.label}
                    </button>
                  ))}
                </span>
                {/* Your own calls today, from midnight in the agency's timezone. */}
                {stats && (
                  <p className={cn(small, "mt-2 tabular-nums")} title={`Your calls since midnight ${zoneShort(stats.zone) || stats.zone}. A contact is a recorded outcome that was a conversation.`}>
                    Today: <strong className="font-semibold text-[var(--ink)]">{stats.dials.toLocaleString()}</strong> {stats.dials === 1 ? "dial" : "dials"} · <strong className="font-semibold text-[var(--ink)]">{stats.contacts.toLocaleString()}</strong> {stats.contacts === 1 ? "contact" : "contacts"} · {stats.contactRate === null ? "no contact rate yet" : <><strong className="font-semibold text-[var(--ink)]">{Math.round(stats.contactRate)}%</strong> contact rate</>}
                  </p>
                )}
              </div>
            )}

            {searchMode ? (
              <>
                {visibleLeads.map((lead) => {
                  const state = String(lead.values.state ?? "State missing");
                  const product = productLineLabel(String(lead.product_line ?? lead.values.product_line ?? lead.values.product ?? ""));
                  const selected = selectedId === lead.id;
                  return (
                    <button key={lead.id} type="button" onClick={() => selectLead(lead.id)} aria-pressed={selected} className={cn("block w-full border-t border-[var(--border)] px-3.5 py-[11px] text-left first:border-t-0", selected ? "bg-[var(--brand-50)] shadow-[inset_2px_0_0_var(--primary)]" : "bg-transparent hover:bg-[var(--canvas)]")}>
                      <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{leadName(lead.values)}</span>
                      <span className={cn(small, "mt-[3px] block")}>{product} · {state} · {formatUsPhone(String(lead.values.phone ?? lead.values.phone_number ?? "")) || "No phone"}</span>
                    </button>
                  );
                })}
                {visibleLeads.length === 0 && <p className={cn(small, "px-3.5 py-6 text-center")}>No leads match that identity search.</p>}
              </>
            ) : (
              <>
                {served && panel && panel.lead.id === served.leadId && (
                  <div aria-current="true" className="border-t border-[var(--border)] bg-[var(--brand-50)] px-3.5 py-[11px] shadow-[inset_2px_0_0_var(--primary)] first:border-t-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</span>
                      {served.tierName && <Pill tone={PRIORITY_TONE[priorityForTier(served.tierName)]} dot>{priorityForTier(served.tierName)}</Pill>}
                    </span>
                    <span className={cn(small, "mt-[3px] block tabular-nums")}>
                      {attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling)}{eligibility?.timezone ? ` · ${localClock(eligibility.checkedAt, eligibility.timezone)} local` : ""} · on your screen
                    </span>
                  </div>
                )}
                {(attempt || readOnly) && queue?.available && queue.rows.length > 0 && (
                  <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-2")}>{readOnly ? "Read-only access: picking a lead claims it, so the list is for looking only." : "Finish this call before picking another lead."}</p>
                )}
                {queue?.available && queue.rows.map((row) => {
                  const priority = priorityForTier(row.tierName);
                  const refusal = pickRefusals[row.workItemId];
                  return (
                    <button
                      key={row.workItemId}
                      type="button"
                      onClick={() => void pickLead(row)}
                      disabled={readOnly || Boolean(attempt) || picking !== null}
                      aria-describedby={refusal ? `pick-${row.workItemId}` : undefined}
                      className="block w-full border-t border-[var(--border)] bg-transparent px-3.5 py-[11px] text-left first:border-t-0 hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{row.name ?? "Unnamed lead"}</span>
                        <Pill tone={PRIORITY_TONE[priority]} dot>{priority}</Pill>
                      </span>
                      <span className={cn(small, "mt-[3px] block tabular-nums")}>
                        {picking === row.workItemId ? "Serving…" : `Attempt ${row.attemptsMade + 1}${row.localTime ? ` · ${row.localTime} local` : ""} · in window${row.assignedToYou ? " · assigned to you" : ""}`}
                      </span>
                      {refusal && <span id={`pick-${row.workItemId}`} role="alert" className="mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{refusal}</span>}
                    </button>
                  );
                })}
                {queue && !queue.available && <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-3")} role="status">{queue.message}</p>}
                {queueError && <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] leading-[1.5] text-[var(--error-ink)]" role="alert">{queueError}</p>}
                {queue?.available && queue.rows.length === 0 && !(served && panel) && (
                  <p className={cn(small, "px-3.5 py-6 text-center")} role="status">{queueFilter === "all" ? "Nothing else is servable to you right now." : "Nothing in this priority is servable to you right now."}</p>
                )}
                {queue?.available && queue.rows.length > 0 && (
                  <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-2.5")}>
                    The next {queue.rows.length} of {queue.capped ? `more than ${queue.cap.toLocaleString()}` : queue.count.toLocaleString()} servable to you now, in tier order. Priority comes from the tier, never the score. Serve next may choose differently within a tier.
                  </p>
                )}
              </>
            )}
          </section>

          {/* The served card: what the server chose and why, and the lock the agent now holds. */}
          {!searchMode && !loading && (served ? (
            <SettingsCard pad={18}>
              <div className="flex items-center justify-between gap-3">
                <span className={label}>Served to you</span>
                <Pill tone={served.tierName ? PRIORITY_TONE[priorityForTier(served.tierName)] : "neutral"}>{served.tierName ? served.tierName.replaceAll("_", " ") : "held"}</Pill>
              </div>
              {selectionReasonParts(served.selectionReason).length > 1 ? (
                <ul className={cn(body14, "m-0 mt-2 list-disc space-y-0.5 pl-5")} aria-label="Why this lead is first">
                  {selectionReasonParts(served.selectionReason).map((part) => <li key={part}>{part}</li>)}
                </ul>
              ) : (
                <p className={cn(body14, "mt-2")}>{served.selectionReason ?? "Served from the queue."}</p>
              )}
              {served.appointmentNotes && <p className={cn(body14, "mt-2")}><strong className="font-semibold text-[var(--ink)]">Setter notes.</strong> {served.appointmentNotes}</p>}
              <p className={cn(small, "mt-2")}>{served.lockedUntil ? `Locked to you until ${new Date(served.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. An abandoned lead returns to the pool automatically — or to you, if it was assigned to you.` : "Held by you."}</p>
            </SettingsCard>
          ) : (
            !readOnly && <p className={cn(small, "px-1")} role="status">{emptyReason ?? "Press Serve next lead, or pick a lead above."}</p>
          ))}

          {!isSetter && <form onSubmit={(event) => void searchLeads(event)} className={cn(card, "p-4")}>
            <label htmlFor="dialer-search" className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Find a lead</label>
            <p className={cn(small, "mt-0.5")}>For a customer who is on the phone. Opening one does not serve it.</p>
            <input id="dialer-search" type="search" className={cn(control, "h-10 text-[14px]")} placeholder="Name, phone or email" value={search} onChange={(event) => setSearch(event.target.value)} />
            <button type="submit" disabled={searching || search.trim().length < 2} className={btn("secondary", "mt-2 w-full")}>{searching ? "Searching…" : "Search"}</button>
          </form>}
        </div>

        {/* ── centre: the lead ────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {panelError && <Callout tone="error" title="Could not load this lead">{panelError}</Callout>}
          {loading && <p className={cn(small, "py-8 text-center")} role="status">Serving your next lead…</p>}
          {!loading && !panel && !loadingPanel && !panelError && (
            <DashedCard title={searchMode ? "Open a search result" : "No lead on your screen"}>
              {searchMode ? "Choose a lead from the results to see its compliance checks and script." : emptyReason ?? (readOnly ? "Read-only access does not serve leads." : "Serve the next lead, or pick one from the queue.")}
            </DashedCard>
          )}
          {loadingPanel && <p className={cn(small, "py-8 text-center")} role="status">Loading server-verified call guidance…</p>}

          {panel && <>
            <section className={cn(card, "p-6")} aria-label="Lead">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <h2 className="m-0 text-[24px] leading-[1.21] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</h2>
                  <p className="mt-1.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)] tabular-nums">
                    {[
                      panel.lead.phone ? formatUsPhone(panel.lead.phone) : "No phone number",
                      panel.lead.age ? `age ${panel.lead.age}` : null,
                      panel.lead.state || "state missing",
                      eligibility?.timezone ? `${localClock(eligibility.checkedAt, eligibility.timezone)} local time (${zoneShort(eligibility.timezone)})` : "Local time unknown",
                      attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling).toLowerCase(),
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {!attempt ? (
                  <button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={readOnly || working || !callReady} title={!callReady ? blockers[0] : undefined} className={btn("primary", "h-11")}>
                    {readOnly ? "Read-only account" : searchMode ? "Log inbound return call" : "Click to call"}
                  </button>
                ) : dialled ? (
                  <button type="button" disabled title="The call has started; record what happened." className={btn("primary", "h-11")}>Call started</button>
                ) : (
                  <button type="button" className={btn("primary", "h-11")} disabled={!confirmed || !eligibility?.allowed || !panel.lead.phone || working} aria-describedby="dial-status" onClick={() => void dial()}>
                    {working ? "Checking…" : eligibility?.allowed ? "Start call" : "Dialing blocked"}
                  </button>
                )}
              </div>
              <dl className="m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {[
                  ["Campaign", panel.campaign?.name ?? "—"],
                  ["Vendor", panel.campaign?.vendorName ?? "—"],
                  ["Source", panel.campaign ? sourceLabel(panel.campaign.leadType) : "—"],
                  ["Product", productLineLabel(panel.lead.productCode)],
                ].map(([term, detail]) => (
                  <div key={term} className="min-w-0"><dt className={label}>{term}</dt><dd className={cn(value, "m-0")}>{detail}</dd></div>
                ))}
              </dl>
              {!panel.campaign && <p className={cn(small, "mt-3")}>This lead is not attached to a campaign, so there is no vendor or list type to show.</p>}
              {campaignLine && <p className={cn(small, "mt-3 tabular-nums")}>{campaignLine}</p>}

              {!panel.disclosure.configured && (
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <p className={label}>Required disclosure · {panel.disclosure.state || "unknown state"}</p>
                  <p className="mt-1.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{panel.disclosure.requiredText}</p>
                </div>
              )}
              {/* The wording is on screen as soon as the lead loads, and cannot be hidden. Recording
                  that it was read is still what unlocks the dial (confirm-to-dial kept). */}
              {panel.disclosure.configured && !attempt && (
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <p className={label}>{stateName ?? panel.disclosure.state} requires this wording · cannot be hidden</p>
                  <p className="mt-1.5 text-[16px] leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>
                  <p className={cn(small, "mt-2")}>Press {searchMode ? "Log inbound return call" : "Click to call"}, read it out, then record that you read it. The call cannot start until you do.</p>
                </div>
              )}
              {attempt && (
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <p className={label}>{panel.disclosure.configured ? `${stateName ?? panel.disclosure.state} requires this wording · cannot be hidden` : `Required disclosure · ${panel.disclosure.state || "unknown state"}`}</p>
                  <p className="mt-1.5 text-[16px] leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void confirmRead()} disabled={readOnly || working || confirmed || panel.disclosure.blocking} className={btn("secondary", "h-10")}>
                      {confirmed ? "Read and recorded" : "I read this disclosure"}
                    </button>
                    <p id="dial-status" className={small} role="status">
                      {!confirmed ? "Read the disclosure aloud and record it before dialing." : dialled ? "The call has started. Record what happened on the right." : eligibility?.allowed ? "The server will repeat compliance checks immediately before dialing." : eligibility?.message || "Dialing is blocked until the server eligibility check passes."}
                    </p>
                  </div>
                </div>
              )}
              {/* A recycle pass (20260925706500): the angle it is being called on, and its script. */}
              {panel.recycle && (
                <div className="mt-4">
                  <p className={cn(small, "font-semibold text-[var(--ink)]")}>Recycled · angle: {panel.recycle.angle}{panel.recycle.recycledAt ? <span className="font-normal text-[var(--muted)]"> · {shortDate(panel.recycle.recycledAt)}</span> : null}</p>
                  {panel.recycle.script && <p className={cn(body14, "mt-1 whitespace-pre-line")}>{panel.recycle.script}</p>}
                </div>
              )}
            </section>

            <section className={cn(card, "p-6")} aria-label="Eligibility and compliance">
              <div className="flex items-center justify-between gap-4">
                <h2 className={h2}>Eligibility &amp; compliance</h2>
                <Pill tone={callReady ? "success" : "error"} dot>{callReady ? "Allowed" : "Blocked"}</Pill>
              </div>
              <dl className="m-0 mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
                <div className="min-w-0"><dt className={label}>Consent on file</dt><dd className={cn(value, "m-0")}>{consentLabel(panel.consent)}</dd></div>
                <div className="min-w-0">
                  <dt className={label}>DNC</dt>
                  <dd className={cn(value, "m-0", eligibility?.dncCheck === "unavailable" && "text-[var(--error-ink)]")}>
                    {eligibility?.dncCheck === "unavailable" ? "No DNC vendor is answering · dialing refused" : "Checked when you call"}
                    {panel.lastDncCheck && <span className="block font-normal text-[var(--muted)] text-[12px]">Last: {panel.lastDncCheck.result === "clear" ? "clear" : panel.lastDncCheck.result === "listed" ? "listed, dial refused" : "no vendor answered"} · {agoLabel(Date.parse(panel.lastDncCheck.checkedAt), Date.now())}</span>}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className={label}>Licence</dt>
                  <dd className={cn(value, "m-0", eligibility?.licence && eligibility.licence.status !== "live" && "text-[var(--error-ink)]")}>
                    {!eligibility?.licence
                      ? eligibility?.reason === "no_state" ? "Unknown · the lead has no state" : "Checked when you call"
                      : eligibility.licence.status === "live"
                        ? `${eligibility.licence.state} licence live${eligibility.licence.expiresAt ? ` · until ${shortDate(eligibility.licence.expiresAt)}` : ""}`
                        : eligibility.licence.status === "refused" ? `Not licensed in ${eligibility.licence.state}` : "Could not be checked"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className={label}>Calling window</dt>
                  <dd className={cn(value, "m-0", panel.window ? !panel.window.allowed && "text-[var(--error-ink)]" : eligibility?.reason === "outside_window" && "text-[var(--error-ink)]")}>
                    {panel.window
                      ? panel.window.allowed && panel.window.endMinute !== null
                        ? `Open until ${minuteLabel(panel.window.endMinute)}${panel.window.zone ? ` ${zoneShort(panel.window.zone)}` : ""}`
                        : windowClosedLabel(panel.window.reason, panel.window.startMinute, panel.window.zone)
                      : eligibility?.reason === "outside_window" ? "Closed now" : eligibility?.reason === "no_state" ? "Unknown · the lead has no state" : "Checked when you call"}
                  </dd>
                </div>
              </dl>
              {/* The suppression stack (user decision 2026-09-25): every stored list, re-read at the
                  moment of dialing — the agency's own list plus the litigator, federal and state DNC
                  scrub hits. A hit refuses the dial with the list named. */}
              <div className="mt-4 border-t border-[var(--border)] pt-3.5">
                <p className={label}>Suppression stack · re-checked at dial</p>
                <dl className="m-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5">
                  {SUPPRESSION_LISTS.filter((list) => list.key !== "invalid" || stackHits?.some((hit) => hit.listType === "invalid")).map((list) => {
                    const hit = stackHits?.find((row) => row.listType === list.key) ?? null;
                    const result = list.key === "internal"
                      ? eligibility?.suppression === "suppressed" || hit ? "Listed" : eligibility?.suppression === "unavailable" ? "Could not be checked" : eligibility?.suppression === "not_checked" ? "Not checked · no valid phone" : eligibility?.suppression === "clear" ? "Clear" : "—"
                      : hit ? "Listed" : stackHits ? "Clear" : eligibility?.suppression === "not_checked" ? "Not checked · no valid phone" : "Not re-read here yet";
                    const bad = result === "Listed" || result === "Could not be checked";
                    return (
                      <div key={list.key} className="contents">
                        <dt className={body14}>{list.label}</dt>
                        <dd className={cn("m-0 text-right text-[14px] leading-[1.5] font-semibold tracking-[-0.02em]", bad ? "text-[var(--error-ink)]" : result === "Clear" ? "text-[var(--success-ink)]" : "text-[var(--muted)]")}>
                          {result}{hit?.addedAt && <span className="block text-[12px] font-normal text-[var(--muted)]">since {shortDate(hit.addedAt)}</span>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <p className={cn(small, "mt-2")}>
                  {stackHits
                    ? "Stored scrub results and your own list, read again when you press Start call. The DNC registry is looked up live at that moment too (the DNC row above)."
                    : "Only your own list is read at the dial until a database update is applied; the scrub lists still keep a listed number out of the queue."}
                </p>
              </div>
              {/* The licence's refusal is the server's sentence here, with every other reason the
                  call cannot be placed. */}
              {blockers.length > 0 && (
                <ul className="m-0 mt-3.5 list-none space-y-1 p-0">
                  {blockers.map((line) => <li key={line} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{line}</li>)}
                </ul>
              )}
              <p className={cn(small, "mt-3.5")}>Server checks repeat immediately before dialing. The browser never dials from this panel&rsquo;s state.</p>
            </section>

            <section className={cn(card, "flex flex-col overflow-hidden")} aria-label="Suggested script">
              <div className={cn(barHead, "flex-wrap")}>
                <span className={barTitle}>Suggested script</span>
                <span className="flex flex-wrap items-center gap-2.5">
                  <Pill tone="neutral">{panel.script.version ? `Version ${panel.script.version}` : "Default script"}</Pill>
                  {canAuthor && <button type="button" onClick={() => setEditingScript((open) => !open)} className={btn("secondary")}>{editingScript ? "Cancel" : "Edit"}</button>}
                  {canAuthor && <button type="button" onClick={() => void saveCurrentScript()} disabled={!editingScript || working} title={!editingScript ? "Edit the script first" : undefined} className={btn("secondary")}>Save new version</button>}
                </span>
              </div>
              {editingScript ? (
                <div className="space-y-3 px-5 py-4">
                  {/* LA-2.23: an unknown variable resolves to nothing, so the editor names the ones that exist. */}
                  <p className={small}>
                    Saving publishes a new version for every agent from their next lead; calls already made keep the version they used. Variables: <code>{"{{first_name}}"}</code>, <code>{"{{state}}"}</code>, <code>{"{{age}}"}</code>, <code>{"{{agent_name}}"}</code>, <code>{"{{agency_name}}"}</code>, <code>{"{{product}}"}</code>, <code>{"{{consent_date}}"}</code> — anything else is replaced with nothing rather than shown.
                  </p>
                  {scriptSections.map((key) => (
                    <div key={key}>
                      <label htmlFor={`script-${key}`} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{SECTION_LABELS[key]}</label>
                      <textarea id={`script-${key}`} className={cn(control, "h-auto min-h-24 py-2 text-[14px]")} value={draftSections[key] ?? ""} onChange={(event) => setDraftSections((current) => ({ ...current, [key]: event.target.value }))} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-4">
                  <p className="m-0 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">&ldquo;{String(panel.script.sections.opening ?? "")}&rdquo;</p>
                  {scriptSections.slice(1).map((key) => (
                    <div key={key} className="mt-3.5">
                      <p className={label}>{SECTION_LABELS[key]}</p>
                      <p className={cn(body14, "mt-1")}>{String(panel.script.sections[key] ?? "")}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <SettingsCard title="Rebuttals" sub="One click to expand." pad={20}>
              <div className="grid gap-2">
                {panel.rebuttals.map((item) => (
                  <button key={item.id} type="button" onClick={() => setRebuttal(rebuttal === item.id ? null : item.id)} aria-expanded={rebuttal === item.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:bg-[var(--canvas)]">
                    <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.label}</span>
                    {rebuttal === item.id && <span className={cn(body14, "mt-1 block")}>{item.body}</span>}
                  </button>
                ))}
              </div>
            </SettingsCard>

            {(!served || served.leadId !== panel.lead.id) && (
              <SettingsCard title="Why this lead?" sub="The reason the queue last chose it." pad={20}>
                {reasonParts.length > 1 ? (
                  <ul className={cn(body14, "m-0 list-disc space-y-0.5 pl-5")}>{reasonParts.map((part) => <li key={part}>{part}</li>)}</ul>
                ) : (
                  <p className={body14}>{panel.selectionReason ?? "The queue has not served this lead yet, so there is no selection reason."}</p>
                )}
              </SettingsCard>
            )}

            <section className={cn(card, "flex flex-col overflow-hidden")} aria-label="Recent call history">
              <div className={barHead}>
                <span className={barTitle}>Recent call history</span>
                <span className={small}>{panel.attemptHistory.length} recorded</span>
              </div>
              {slotFacts && (
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <p className={small}>
                    <span className="font-semibold text-[var(--ink)]">Slots tried: </span>
                    {slotFacts.tried.length === 0
                      ? "none yet"
                      : slotFacts.tried.map((row) => `${slotLabel(row.slot)} (${dateTime(row.attemptedAt, customerZone ?? viewerTimeZone(), { weekday: true, clock: "12h" })}${row.disposition ? `, ${(DISPOSITION_LABELS[row.disposition] ?? row.disposition.replaceAll("_", " ")).toLowerCase()}` : ""})`).join(" · ")}
                  </p>
                  <p className={cn(small, "mt-1")}>
                    <span className="font-semibold text-[var(--ink)]">Not tried yet: </span>
                    {slotFacts.untried.length ? slotFacts.untried.map((slot) => slotLabel(slot)).join(", ") : "every slot has been tried; the least recently used one is reused"}
                  </p>
                  {panel.lead.leadState === "retry" && panel.lead.nextDialAfter && (
                    <p className={cn(small, "mt-1")}>
                      <span className="font-semibold text-[var(--ink)]">Next: </span>
                      attempt {(panel.lead.attemptsMade ?? 0) + 1} due {dateTime(panel.lead.nextDialAfter, customerZone ?? viewerTimeZone(), { weekday: true, clock: "12h" })}{customerZone ? ` their time` : ""}{panel.lead.nextSlot ? `, in the ${slotLabel(panel.lead.nextSlot).toLowerCase()} slot` : ""}.
                    </p>
                  )}
                  <p className={cn(small, "mt-1")}>Serve next prefers a slot this lead has not been tried in; slots are the customer&rsquo;s time of day.</p>
                </div>
              )}
              {panel.attemptHistory.length === 0 ? <p className={cn(small, "px-4 py-4")}>No previous call attempts.</p> : (
                <div className="min-w-0 overflow-x-auto">
                  <table className={st.table}>
                    <thead><tr className={st.headRow}>{["Date / time", "Attempt", "Slot", "Result", "Evidence"].map((head) => <th key={head} scope="col" className={st.th}>{head}</th>)}</tr></thead>
                    <tbody>
                      {panel.attemptHistory.map((item) => (
                        <tr key={item.id}>
                          <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{dateTime(item.attemptedAt, viewerTimeZone(), { clock: "12h" })}</td>
                          <td className={cn(st.td, "tabular-nums")}>{item.attemptNumber}</td>
                          <td className={cn(st.td, "whitespace-nowrap")}>{slotLabel(item.slot)}</td>
                          <td className={st.td}>{item.disposition ? DISPOSITION_LABELS[item.disposition] ?? item.disposition.replaceAll("_", " ") : "In progress"}{item.disposition === "callback_scheduled" && <span className={st.sub}>Callback scheduled</span>}</td>
                          <td className={st.td}>{item.dialClicked ? "Dial recorded" : "Not dialed"}<span className={st.sub}>{item.disclosureConfirmed ? "Disclosure confirmed" : "Disclosure pending"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>}
        </div>

        {/* ── right: the outcome ──────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 lg:w-[300px] lg:shrink-0">
          {panel && (
            <section className={cn(card, "p-5")} aria-label="Disposition">
              <h2 className={h2}>Disposition</h2>
              <div className="mt-3.5 flex flex-col gap-2">
                {outcomes.slice(0, searchMode ? 1 : primaryCount).map((item) => (
                  <button key={item} type="button" onClick={() => choose(item)} disabled={!dialled || working} aria-pressed={(pendingCallback && item === "callback_scheduled") || undefined} className={btn(item === "application_submitted" ? "primary" : "secondary", "h-10 w-full")}>
                    {DISPOSITION_LABELS[item]}
                  </button>
                ))}
              </div>
              {!searchMode && (
                <>
                  <p className={cn(label, "mt-4")}>More outcomes</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {outcomes.slice(primaryCount).map((item) => (
                      <button key={item} type="button" onClick={() => choose(item)} disabled={!dialled || working} aria-pressed={(pendingDnc && item === "do_not_call") || undefined} className={btn("secondary", cn("h-10 w-full px-2", item === "do_not_call" && "text-[var(--error-ink)]"))}>
                        {DISPOSITION_LABELS[item]}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {pendingCallback && (
                <div className="mt-3 space-y-2 rounded-[8px] border border-[var(--border)] p-3">
                  {/* The customer's own clock, not the agent's: "Tuesday at 2pm" is a promise made to the person who answered. */}
                  <label htmlFor="callback-at" className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Call back at — {eligibility?.timezone ? <>customer&rsquo;s time ({zoneShort(eligibility.timezone)})</> : "the customer's local time"}</label>
                  <input id="callback-at" type="datetime-local" className={cn(control, "h-10 text-[14px]")} value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} />
                  <p className={small}>Their local time is currently {eligibility?.timezone ? localClock(Date.now(), eligibility.timezone) : "unknown"}.</p>
                  {/* The Callbacks page's conversion line and checks (lib/callbacks/windowFacts.ts). Advisory: the server re-checks the window when it books. */}
                  {callbackInstant !== null && customerZone && (
                    <p className={cn(small, "tabular-nums")}>
                      <span className="font-semibold text-[var(--ink)]">{dateTime(callbackInstant, customerZone, { weekday: true, clock: "12h" })} {zoneShort(customerZone)}</span> = {dateTime(callbackInstant, viewerTimeZone(), { weekday: true, clock: "12h" })} your time
                    </p>
                  )}
                  {callbackAt && (
                    <div className="flex flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        {callbackInWindow === null
                          ? <Pill tone="neutral">{callbackWindow ? "Choose a time" : "Window not loaded"}</Pill>
                          : callbackInWindow ? <Pill tone="success" dot>Inside the {stateName ?? "customer's"} calling window</Pill>
                          : <Pill tone="error" dot>Outside the {stateName ?? "customer's"} calling window</Pill>}
                        {callbackInFuture === null ? null : callbackInFuture ? <Pill tone="success" dot>In the future</Pill> : <Pill tone="error" dot>In the past</Pill>}
                      </span>
                      {callbackWindow && <span className={small}>{windowSummary(callbackWindow)}{callbackWindow.noSunday ? " · no Sunday calls" : ""}</span>}
                    </div>
                  )}
                  {callbackClash && (
                    <Callout tone="warning" title="You already have an appointment then">
                      {dateTime(callbackClash.startsAtUtc, viewerTimeZone(), { weekday: true, clock: "12h" })} your time, for {callbackClash.durationMinutes || 30} minutes. The callback can still be booked; it will be due while you are in that appointment.
                    </Callout>
                  )}
                  <div className="flex gap-2">
                    <button type="button" disabled={!callbackAt || !eligibility?.timezone || working || callbackInWindow === false || callbackInFuture === false} title={callbackInWindow === false ? "Outside the customer's calling window" : callbackInFuture === false ? "That time has passed for the customer" : undefined} onClick={() => void disposition("callback_scheduled", { callback_local: callbackAt, customer_timezone: eligibility?.timezone })} className={btn("primary-sm")}>Book the callback</button>
                    <button type="button" disabled={working} onClick={() => { setPendingCallback(false); setCallbackAt(""); }} className={btn("row")}>Cancel</button>
                  </div>
                  {!eligibility?.timezone && <p className="text-[12px] leading-[1.5] text-[var(--error-ink)]">This lead has no state on it, so there is no timezone to book against. Add one on the lead first.</p>}
                </div>
              )}

              {pendingDnc && (
                <div className="mt-3 rounded-[8px] border border-[var(--border)] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3" role="alertdialog" aria-label="Confirm do not call">
                  <p className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">Add this number to the do-not-call list?</p>
                  <p className={cn(body14, "mt-1")}>It goes on your agency&rsquo;s internal list permanently and this lead is closed. It will never be served or dialed again.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={working} onClick={() => void disposition("do_not_call")} className={btn("primary-sm")}>Record do not call</button>
                    <button type="button" disabled={working} onClick={() => setPendingDnc(false)} className={btn("row")}>Cancel</button>
                  </div>
                </div>
              )}

              {pendingReturn && (
                <div className="mt-3 rounded-[8px] border border-[var(--border)] p-3" role="alertdialog" aria-label={`Confirm ${DISPOSITION_LABELS[pendingReturn].toLowerCase()}`}>
                  <p className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Record {DISPOSITION_LABELS[pendingReturn].toLowerCase()}?</p>
                  <p className={cn(body14, "mt-1")}>Closes this lead; it is not dialed again.</p>
                  <p className={cn(small, "mt-1", panel.returnWindow?.claimable ? "text-[var(--success-ink)]" : undefined)}>{returnWindowLine(panel.returnWindow)}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={working} onClick={() => void disposition(pendingReturn)} className={btn("primary-sm")}>Record {DISPOSITION_LABELS[pendingReturn].toLowerCase()}</button>
                    <button type="button" disabled={working} onClick={() => setPendingReturn(null)} className={btn("row")}>Cancel</button>
                  </div>
                </div>
              )}

              {dispositionError && <p role="alert" className="mt-3 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{dispositionError}</p>}
              <p className={cn(small, "mt-3")}>
                {!attempt ? "Record the result after the call starts." : !dialled ? "Start the call first; the outcome is recorded against it." : searchMode ? "Record the result of this call." : `Record the result. Keys 1-${Math.min(9, dispositions.length)} choose a disposition; N serves the next lead.`}
              </p>
              {searchMode && <p className={cn(small, "mt-2")}>This call was started by the customer, so it does not use one of this lead&apos;s outbound attempts and does not change its retry schedule.</p>}
              {/* The structured outcome (the walk, an outcome, callback details) for a served lead's
                  work item. Owners and producers; a setter keeps the buttons above.
                  With a dialled attempt open it is CALL mode (user decision 2026-09-24): the outcome
                  is recorded against that attempt by the dialer's own route, so the attempt closes,
                  the cadence advances and the verification gate runs, and the walked answers are
                  stored with the attempt. With no attempt it is the inbound path, for a conversation
                  that did not start here. Hidden while an attempt is prepared but not dialled, as
                  the buttons above are disabled then. */}
              {!isSetter && !searchMode && panel.lead.workItemId && (!attempt || dialled) && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <button type="button" onClick={() => setOutcomeOpen(true)} disabled={working} className={btn("secondary", "h-10 w-full")}>Open call outcome</button>
                  <p className={cn(small, "mt-2")}>
                    {attempt
                      ? <>Walks the questions for this lead&rsquo;s stage and records the outcome against this call: the attempt closes, the lead&rsquo;s next step follows the outcome&rsquo;s settings, and the next lead is served.</>
                      : <>For a conversation that did not start from this dialer. Walks the questions for this lead&rsquo;s stage, records one mapped outcome and serves the next lead.</>}
                  </p>
                </div>
              )}
            </section>
          )}
          {panel && !isSetter && !searchMode && panel.lead.workItemId && (
            <DispositionWizardDialog
              key={`${panel.lead.workItemId}:${attempt && dialled ? attempt.id : "no-call"}`}
              workItemId={panel.lead.workItemId}
              attemptId={attempt && dialled ? attempt.id : undefined}
              open={outcomeOpen}
              onOpenChange={setOutcomeOpen}
              readOnly={readOnly}
              onRecorded={() => {
                setOutcomeOpen(false);
                notify.done("Call outcome recorded");
                resetCall();
                void serveNextNow();
              }}
            />
          )}
          <Callout tone="info" title="A read disclosure is evidence">It posts as its own recorded step, not a checkbox on this form.</Callout>

          {panel && !readOnly && calendar && calendar.agents.length > 0 && (
            <SettingsCard title="Book an appointment" sub="Qualified? Put them on the calendar. The lead then arrives in the appointment tier with your notes attached." pad={20}>
              <div className="space-y-3">
                <div>
                  <label htmlFor="book-agent" className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Agent</label>
                  <select id="book-agent" className={cn(control, "h-10 text-[14px]")} value={bookAgent} onChange={(event) => setBookAgent(event.target.value)}>{calendar.agents.map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name}{agent.timezone ? ` · ${agent.timezone}` : ""}</option>)}</select>
                </div>
                {/* Slot-only (Appointments audit, 2026-09-25): the agent's open slots, in the customer's
                    time first and "= your time" after. Slots outside the customer's published calling
                    window are left out; the server still checks every rule when it books. */}
                <div>
                  <label htmlFor="book-slot" className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Open times{customerZone ? <> — customer&rsquo;s time ({zoneShort(customerZone)})</> : ""}</label>
                  {bookableSlots.length > 0 ? (
                    <select id="book-slot" className={cn(control, "h-10 text-[14px]")} value={bookableSlots.includes(bookSlot) ? bookSlot : ""} onChange={(event) => setBookSlot(event.target.value)}>
                      <option value="">Choose a time</option>
                      {bookableSlots.map((slot) => <option key={slot} value={slot}>{slotOptionLabel(slot, customerZone)}</option>)}
                    </select>
                  ) : (
                    <p className={cn(small, "mt-1")} role="status">No open times for this agent in the next 7 days{panel.callbackWindow ? " inside the customer's calling window" : ""}. Choose another agent, or open their calendar.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="book-notes" className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Notes for the agent</label>
                  <textarea id="book-notes" rows={3} className={cn(control, "h-auto py-2 text-[14px]")} value={bookNotes} onChange={(event) => setBookNotes(event.target.value)} placeholder="What was discussed, and what to lead with." />
                </div>
                <p className={small}>The server checks the customer&apos;s legal calling window, the agent&apos;s working hours and blocked time, and their daily appointment limit. A slot taken while you were booking is refused rather than double-booked.</p>
                <button type="button" disabled={!bookAgent || !bookSlot || booking} title={!bookSlot ? "Choose one of the open times first" : undefined} onClick={() => void bookAppointment()} className={btn("primary", "w-full")}>{booking ? "Booking…" : "Book appointment"}</button>
              </div>
            </SettingsCard>
          )}

          {panel && !readOnly && !isSetter && <Card className="portal-dialer-interested">
            <div className="px-5">
              <p className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">They are interested</p>
              <p className={cn(small, "mt-1")}>Opens the same verification panel an inbound transfer uses, prefilled from the list data. The campaign stays attached, which is what makes cost per issued policy computable. Recording the Application outcome is separate.</p>
              <button type="button" disabled={starting || !panel.lead.workItemId} title={!panel.lead.workItemId ? "Only a lead served to you can start an application" : undefined} onClick={() => void startApplication()} className={btn("primary", "mt-3 w-full")}>{starting ? "Starting…" : "Start application"}</button>
            </div>
          </Card>}
        </div>
      </div>
    </div>
  );
}
