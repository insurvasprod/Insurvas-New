import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { notify, setCallInProgress } from "@/lib/notify";

import { openSlots, type PickerContext } from "@/lib/appointments/calendarMath";
import { insideWindow, STATE_NAMES } from "@/lib/callbacks/windowFacts";
import { productLineLabel } from "@/lib/format/productLine";
import { viewerTimeZone } from "@/lib/format/dates";
import { costPerLeadLabel, formatUsPhone, selectionReasonParts, shortDate, slotsTried } from "@/lib/dialerScripts/display";
import { APPLICATION_OUTCOME, FALLBACK_DIALER_OUTCOMES, INBOUND_RETURN_CALL, outcomeIndexForKey, outcomesForRole, type DialerOutcome } from "@/lib/dialerScripts/outcomes";
import { callbackQuickOptions } from "@/lib/dialerScripts/callbackQuick";
import { searchRebuttals } from "@/lib/dialerScripts/rebuttals";
import { type Attempt, CALLBACK_OUTCOME, DNC_OUTCOME, type Lead, type Panel, type Queue, type QueueFilter, type QueueRow, RETURNABLE, type Served, announceDisposition, errorText, instantInZone, keyWords, scriptSections } from "@/components/app/dialer/model";

/** The state and handlers of DialerWorkspace (UX-6), moved verbatim; the component renders. */
export function useDialer({ readOnly = false, role = "producer", requestedLeadId = null }: { readOnly?: boolean; role?: string; canCheckNumber?: boolean; requestedLeadId?: string | null }) {
  // LA-2.12. A setter works this queue but may not sell, quote or submit an application, and may
  // not "see other setters' leads" — so identity search is not theirs either. Both controls are
  // withheld rather than shown-and-refused: the routes behind them already answer 403, and an
  // offered control that always fails is the dead end this audit keeps removing.
  const isSetter = role === "setter";
  // Scripts and rebuttals are agency-wide; publishing them is an owner's or producer's call.
  const canAuthor = !readOnly && !isSetter;
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
  // LA-2.10-1: the callback's optional note, sent as callback_note.
  const [callbackNote, setCallbackNote] = useState("");
  // LA-2.23-3: the rebuttal library's search box.
  const [rebuttalQuery, setRebuttalQuery] = useState("");

  // The outcome buttons, in key order, from the tenant's dispositions (see the note above RETURNABLE).
  const vocabulary = panel?.outcomes ?? null;
  const dispositions = useMemo<DialerOutcome[]>(() => outcomesForRole(vocabulary?.outcomes ?? FALLBACK_DIALER_OUTCOMES, isSetter), [vocabulary, isSetter]);
  const outcomeLabel = useCallback((key: string) => vocabulary?.labels[key] ?? FALLBACK_DIALER_OUTCOMES.find((row) => row.key === key)?.label ?? keyWords(key), [vocabulary]);
  // LA-2.10-1: "your time" is the agent's own zone (their working hours), else the browser's.
  const agentZone = panel?.viewerTimezone || viewerTimeZone();

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
      // LA-3: the same case opens in the application workspace (build it once). The start call is
      // idempotent — it resumes the case the line above just opened and adds the attempt. A tenant
      // without the Applications feature, or before its migration is applied, goes to the lead page
      // exactly as before.
      const workspace = await fetch("/api/app/applications/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_item_id: panel.lead.workItemId, product_line: panel.lead.productCode || undefined }),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { href?: string } | null;
      router.push(workspace?.href ?? `/app/leads/${panel.lead.id}`);
    } catch { notify.fail("Could not start the application"); }
    finally { setStarting(false); }
  }

  /**
   * Keyboard-only operation for the whole loop — LA-2.9 criterion 6 (LA-2.9-9). `n` serves the next
   * lead, `c` is Click to call, `r` records "I read this disclosure", `d` starts the call, and the
   * number keys pick a disposition in the order they are rendered: 1–9, then 0 for the tenth
   * (Disconnected). A confirmation that opens (Callback, Do not call, Wrong number, Disconnected)
   * takes the focus, so Enter confirms it and Escape cancels; the callback's quick options are
   * buttons, so Tab and Enter book one without typing a date. Guarded on the event target, so typing
   * a script edit or a search never fires one.
   */
  useEffect(() => {
    if (readOnly) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // An open overlay owns the keyboard: a "1" typed in it must not record an outcome behind it.
      if (checkOpen || outcomeOpen) return;
      if (event.key === "Escape" && (pendingCallback || pendingDnc || pendingReturn)) {
        event.preventDefault();
        setPendingCallback(false); setPendingDnc(false); setPendingReturn(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); void serveNext(); return; }
      // Each guarded as its button is: no second attempt while one is being prepared.
      if (key === "c") { if (!attempt && !working && callReady) { event.preventDefault(); void prepareAttempt(searchMode); } return; }
      if (key === "r") { if (attempt && !confirmed && !working && !panel?.disclosure.blocking) { event.preventDefault(); void confirmRead(); } return; }
      if (key === "d") { event.preventDefault(); void dial(); return; }
      const index = outcomeIndexForKey(event.key);
      if (!searchMode && index !== null && index < dispositions.length) {
        event.preventDefault();
        choose(dispositions[index].key);
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
    setAttempt(null); setConfirmed(false); setDialled(false); setRebuttal(null); setEditingScript(false); setPendingCallback(false); setCallbackAt(""); setCallbackNote(""); setPendingDnc(false); setPendingReturn(null); setDispositionError(null);
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
    if (value === CALLBACK_OUTCOME) { setPendingDnc(false); setPendingCallback(true); return; }
    if (value === DNC_OUTCOME) { setPendingCallback(false); setPendingDnc(true); return; }
    if (RETURNABLE.has(value)) { setPendingCallback(false); setPendingDnc(false); setPendingReturn(value); return; }
    void disposition(value);
  }

  async function disposition(value: string, extra: Record<string, unknown> = {}) {
    if (!attempt || !dialled || working) return;
    setWorking(true); setDispositionError(null);
    try {
      const response = await fetch(`/api/app/dialer/attempt/${attempt.id}/disposition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disposition: value, ...extra }) });
      const body = await response.json().catch(() => null);
      // LA-2.9-3 · "Interested – start application". The application outcome is recorded once
      // verification is complete; until then the same press starts the application, which opens
      // the verification panel (the call's outcome is recorded from there when it is done).
      if (!response.ok && value === APPLICATION_OUTCOME && response.status === 409 && body?.code === "verification_incomplete" && !isSetter) {
        await startApplication();
        return;
      }
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
  // The search path offers only the inbound return call (when the tenant has it active).
  const inboundOutcome: DialerOutcome | null = vocabulary
    ? vocabulary.inboundReturnCall ? { key: vocabulary.inboundReturnCall.key, label: vocabulary.inboundReturnCall.label, position: 1 } : null
    : { key: INBOUND_RETURN_CALL, label: outcomeLabel(INBOUND_RETURN_CALL), position: 1 };
  const outcomes: DialerOutcome[] = searchMode ? (inboundOutcome ? [inboundOutcome] : []) : dispositions;
  // The first four positions are the primary buttons (three for a setter, who has no application).
  const primaryCount = searchMode ? outcomes.length : dispositions.filter((row) => row.position <= 4).length;
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
  // LA-2.10-1: later today / tomorrow morning / tomorrow afternoon / next week, in the customer's
  // time and inside their calling window.
  const quickOptions = pendingCallback && customerZone
    ? callbackQuickOptions(Date.now(), customerZone, callbackWindow ? { startHour: callbackWindow.effective.start, endHour: callbackWindow.effective.end, noSunday: callbackWindow.noSunday } : null)
    : [];
  // LA-2.23-3: the library, narrowed by the search box.
  const visibleRebuttals = panel ? searchRebuttals(panel.rebuttals, rebuttalQuery) : [];
  const phoneLabel = panel?.lead.phone ? formatUsPhone(panel.lead.phone) : null;
  // LA-2.9-1: "Phoenix, AZ" — the city when the list carried one.
  const cityState = panel ? [panel.lead.city, panel.lead.state].filter(Boolean).join(", ") : "";
  // D15: the state's wording is on file but is still the seeded placeholder.
  const disclosureUnapproved = Boolean(panel && panel.disclosure.configured && panel.disclosure.approved === false);
  /** The step the call is on, for the key hints and the small-screen call bar. */
  const nextStep: "call" | "read" | "dial" | "outcome" | null = !panel || readOnly ? null : !attempt ? "call" : !confirmed ? "read" : !dialled ? "dial" : "outcome";

  return {
    isSetter,
    canAuthor,
    leads,
    search,
    setSearch,
    searchMode,
    searching,
    selectedId,
    panel,
    panelError,
    attempt,
    loading,
    working,
    confirmed,
    dialled,
    rebuttal,
    setRebuttal,
    editingScript,
    setEditingScript,
    draftSections,
    setDraftSections,
    served,
    emptyReason,
    serving,
    queue,
    queueError,
    queueFilter,
    setQueueFilter,
    picking,
    pickRefusals,
    calendar,
    bookAgent,
    setBookAgent,
    pendingCallback,
    setPendingCallback,
    callbackAt,
    setCallbackAt,
    pendingDnc,
    setPendingDnc,
    pendingReturn,
    setPendingReturn,
    bookSlot,
    setBookSlot,
    bookNotes,
    setBookNotes,
    booking,
    starting,
    checkOpen,
    setCheckOpen,
    outcomeOpen,
    setOutcomeOpen,
    dispositionError,
    callbackNote,
    setCallbackNote,
    rebuttalQuery,
    setRebuttalQuery,
    dispositions,
    outcomeLabel,
    agentZone,
    bookAppointment,
    startApplication,
    resetCall,
    selectLead,
    searchLeads,
    clearLeadSearch,
    visibleLeads,
    saveCurrentScript,
    serveNext,
    serveNextNow,
    pickLead,
    prepareAttempt,
    confirmRead,
    dial,
    choose,
    disposition,
    loadingPanel,
    eligibility,
    outcomes,
    primaryCount,
    blockers,
    callReady,
    stats,
    customerZone,
    slotFacts,
    reasonParts,
    callbackInstant,
    callbackWindow,
    callbackInWindow,
    callbackInFuture,
    callbackClash,
    stateName,
    stackHits,
    bookableSlots,
    campaignLine,
    quickOptions,
    visibleRebuttals,
    phoneLabel,
    cityState,
    disclosureUnapproved,
    nextStep,
  };
}
