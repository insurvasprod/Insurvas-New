"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { Callout } from "@/components/app/settings/primitives";
import { DialerPreflightDialog } from "@/components/app/dialer-preflight";
import { windowSummary } from "@/lib/callbacks/windowFacts";
import { cn } from "@/lib/utils";
import { dateTime } from "@/lib/format/dates";
import { localClock, returnWindowLine, zoneShort } from "@/lib/dialerScripts/display";
import { APPLICATION_OUTCOME, outcomeButtonLabel, outcomeHotkey } from "@/lib/dialerScripts/outcomes";
import { CALLBACK_OUTCOME, DNC_OUTCOME, Kbd, body14, card, fieldClass, fieldLabel, instantInZone, label, outcomeIcon, small } from "@/components/app/dialer/model";
import { useDialer } from "@/components/app/dialer/use-dialer";
import { DialerQueueTable, QueuePriorityChips } from "@/components/app/dialer/queue-table";
import { DialerLeadNotes } from "@/components/app/dialer/lead-notes";
import { DialerLeadColumn } from "@/components/app/dialer/lead-column";
import { useNow } from "@/components/app/applications/outcome/use-now";
import { BookAppointmentDialog } from "@/components/app/dialer/book-appointment-dialog";
import { ScheduleDialog } from "@/components/app/dialer/schedule-dialog";
import { CallbackPicker } from "@/components/app/callbacks/callback-picker";
import { CalendarPlus, Check, Phone, PhoneCall, ShieldCheck, User, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";

export function DialerWorkspace({ readOnly = false, role = "producer", canCheckNumber = false, requestedLeadId = null }: { readOnly?: boolean; role?: string; canCheckNumber?: boolean; requestedLeadId?: string | null }) {
  const dialer = useDialer({ readOnly, role, canCheckNumber, requestedLeadId });
  const now = useNow();
  const { needsDnc, checkingDnc, checkDnc, isSetter, searchMode, panel, attempt, working, dialled, serving, pendingCallback, setPendingCallback, callbackAt, setCallbackAt, pendingDnc, setPendingDnc, pendingReturn, setPendingReturn, checkOpen, setCheckOpen, dispositionError, callbackNote, setCallbackNote, dispositions, outcomeLabel, agentZone, serveNext, prepareAttempt, confirmRead, dial, choose, disposition, eligibility, outcomes, blockers, callReady, stats, customerZone, callbackInstant, callbackWindow, callbackInWindow, callbackInFuture, callbackClash, stateName, quickOptions, phoneLabel, nextStep, confirmed, calendar, autoNext, setAutoNext } = dialer;
  const [bookOpen, setBookOpen] = useState(false);
  const canBook = !readOnly && Boolean(calendar && calendar.agents.length > 0);

  // The Call button, on the right of the lead's facts (owner 2026-10-27).
  const callButton = panel ? (
      <div className="flex flex-col items-stretch gap-2 max-lg:hidden">
        {!attempt && needsDnc ? (
          // Owner 2026-10-29: check the number first; the Call button appears once it is clear.
          <Button type="button" onClick={() => void checkDnc()} disabled={readOnly || checkingDnc || !callReady} aria-describedby={!callReady ? "dialer-blockers" : undefined} aria-keyshortcuts={readOnly ? undefined : "C"} className="h-12 px-6 text-base">
            <ShieldCheck aria-hidden="true" />{readOnly ? "Read-only account" : checkingDnc ? "Checking…" : "DNC / TCPA check"}{!readOnly && <Kbd>C</Kbd>}
          </Button>
        ) : !attempt ? (
          <Button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={readOnly || working || !callReady} aria-describedby={!callReady ? "dialer-blockers" : undefined} aria-keyshortcuts={readOnly ? undefined : "C"} className="h-12 px-6 text-base">
            <Phone aria-hidden="true" />{readOnly ? "Read-only account" : searchMode ? "Log inbound return call" : working ? "Calling…" : `Call ${panel.lead.firstName || "now"}`}{!readOnly && <Kbd>C</Kbd>}
          </Button>
        ) : !confirmed ? (
          <Button type="button" onClick={() => void confirmRead()} disabled={readOnly || working || confirmed || panel.disclosure.blocking} aria-keyshortcuts="R" className="h-12 px-6 text-base">
            <Check aria-hidden="true" />I read this disclosure<Kbd>R</Kbd>
          </Button>
        ) : dialled ? (
          <Button type="button" disabled title="The call has started; record what happened." className="h-12 px-6 text-base"><PhoneCall aria-hidden="true" />Call started</Button>
        ) : (
          <Button type="button" disabled={!confirmed || !eligibility?.allowed || !panel.lead.phone || working} aria-describedby="dial-status" aria-keyshortcuts="D" onClick={() => void dial()} className="h-12 px-6 text-base">
            <PhoneCall aria-hidden="true" />{working ? "Checking…" : eligibility?.allowed ? "Start call" : "Dialing blocked"}<Kbd>D</Kbd>
          </Button>
        )}
        {/* Book an appointment opens once the call is being prepared (2026-10-06). */}
        {attempt && canBook && (
          <Button type="button" variant="outline" onClick={() => setBookOpen(true)}><CalendarPlus aria-hidden="true" />Book appointment</Button>
        )}
      </div>
  ) : null;

  // What the call needs below the facts: why it is blocked, and the booking dialog.
  const callArea = panel ? (
    <div className="flex flex-col gap-4">
      {/* One button that is always the call's next step (Dialer A, 2026-10-25), and, when the call
          cannot be placed, why, in words. Below 1024px the call bar at the foot of the screen
          carries these steps, so here they are desktop only. */}
      {/* Where the call is, in one line. */}
        <p id="dial-status" className="sr-only" role="status">
          {!attempt ? (searchMode ? "Log the return call to record its outcome." : "")
            : !confirmed ? "The disclosure was not recorded. Record it to dial."
            : !dialled ? (eligibility?.allowed ? "The server will repeat compliance checks immediately before dialing." : eligibility?.message || "Dialing is blocked until the server eligibility check passes.")
            : "Call in progress · choose the outcome."}
        </p>
      <BookAppointmentDialog d={dialer} open={bookOpen} onOpenChange={setBookOpen} />
      {!attempt && !readOnly && !callReady && blockers.length > 0 && (
        <ul id="dialer-blockers" className="m-0 list-none space-y-0.5 p-0">
          {blockers.map((line) => <li key={line} className="text-sm leading-[1.5] font-semibold text-[var(--error-ink)]">{line}</li>)}
        </ul>
      )}

    </div>
  ) : null;

  // The outcomes, in the full-height column on the left (owner 2026-10-27).
  const outcomePanel = panel ? (
    <div className="flex flex-1 flex-col gap-4">
      {/* The outcomes as tiles, every one with its key; Interested starts the application. */}
      <div role="group" aria-label="Outcome" id="dialer-disposition" className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className={cn(label, "m-0")}>Outcome</p>
          <p className={cn(small, "m-0")}>
            {!dialled ? "Key: C calls." : searchMode ? "Record the result of this call." : `Keys 1–${Math.min(9, dispositions.length)}${dispositions.length >= 10 ? " and 0" : ""} choose a disposition; N serves the next lead.`}
            {searchMode && " An inbound return call does not use one of this lead’s outbound attempts."}
          </p>
        </div>
        {/* The tiles share the column's full height (owner 2026-10-27), never shorter than a control. */}
        <div className="grid flex-1 auto-rows-fr gap-2">
          {outcomes.map((item, index) => (
            <OutcomeButton key={item.key} icon={outcomeIcon(item.key)} label={outcomeButtonLabel(item)} hotkey={searchMode ? null : outcomeHotkey(index)} tone={item.key === APPLICATION_OUTCOME ? "primary" : item.key === DNC_OUTCOME ? "danger" : "default"} pressed={(pendingCallback && item.key === CALLBACK_OUTCOME) || (pendingDnc && item.key === DNC_OUTCOME)} disabled={!dialled || working} onClick={() => choose(item.key)} />
          ))}
        </div>
        {searchMode && outcomes.length === 0 && <p className={small}>Restore the inbound return call in Settings › Dispositions to log it here.</p>}
      </div>

      {/* The callback, in the Dialer's one scheduling pop-up (owner 2026-10-27): the same shell and
          calendar as Book appointment, in the customer's own time. */}
      <ScheduleDialog
        open={pendingCallback}
        onOpenChange={(open) => { if (!open && !working) { setPendingCallback(false); setCallbackAt(""); setCallbackNote(""); } }}
        title="Schedule a callback"
        description={<>{panel.lead.fullName ?? panel.lead.firstName ? `For ${panel.lead.fullName ?? panel.lead.firstName}. ` : ""}In the customer&rsquo;s time{eligibility?.timezone ? ` (${zoneShort(eligibility.timezone)}, now ${localClock(now, eligibility.timezone)})` : ""} · yours {localClock(now, agentZone)} {zoneShort(agentZone)}.</>}
        submitLabel="Book the callback"
        busyLabel="Booking…"
        busy={working}
        submitDisabled={!callbackAt || !eligibility?.timezone || callbackInWindow === false || callbackInFuture === false}
        submitTitle={callbackInWindow === false ? "Outside the customer's calling window" : callbackInFuture === false ? "That time has passed for the customer" : undefined}
        onSubmit={() => void disposition(CALLBACK_OUTCOME, { callback_local: callbackAt, customer_timezone: eligibility?.timezone, ...(callbackNote.trim() ? { callback_note: callbackNote.trim() } : {}) })}
      >
        {/* LA-2.10-1 quick options: in the customer's time, inside their window; they set the calendar. */}
        {quickOptions.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick callback times">
            {quickOptions.map((option) => (
              <Button key={option.key} type="button" size="sm" variant={callbackAt === option.local ? "default" : "outline"} aria-pressed={callbackAt === option.local} title={customerZone ? `${dateTime(instantInZone(option.local, customerZone) ?? now, customerZone, { weekday: true, clock: "12h" })} ${zoneShort(customerZone)}` : undefined} onClick={() => setCallbackAt(option.local)}>
                {option.label}
              </Button>
            ))}
          </div>
        )}
        {/* The customer's own clock, not the agent's: "Tuesday at 2pm" is a promise made to the person who answered. */}
        <CallbackPicker key={callbackAt && quickOptions.some((option) => option.local === callbackAt) ? callbackAt : "pick"} value={callbackAt} onChange={setCallbackAt} zone={eligibility?.timezone ?? null} disabled={working || !eligibility?.timezone} />
        {/* The Callbacks page's conversion line and checks (lib/callbacks/windowFacts.ts). Advisory: the server re-checks the window when it books. */}
        {callbackInstant !== null && customerZone && (
          <p className={cn(small, "m-0 tabular-nums")}>
            <span className="font-semibold text-[var(--ink)]">{dateTime(callbackInstant, customerZone, { weekday: true, clock: "12h" })} {zoneShort(customerZone)}</span> = {dateTime(callbackInstant, agentZone, { weekday: true, clock: "12h" })} your time ({zoneShort(agentZone)})
          </p>
        )}
        {callbackAt && (
          <div className="flex flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-2">
              {callbackInWindow === null
                ? <StatusChip dot={false} tone="neutral">{callbackWindow ? "Choose a time" : "Window not loaded"}</StatusChip>
                : callbackInWindow ? <StatusChip tone="good" dot>Inside the {stateName ?? "customer's"} calling window</StatusChip>
                : <StatusChip tone="danger" dot>Outside the {stateName ?? "customer's"} calling window</StatusChip>}
              {callbackInFuture === null ? null : callbackInFuture ? <StatusChip tone="good" dot>In the future</StatusChip> : <StatusChip tone="danger" dot>In the past</StatusChip>}
            </span>
            {callbackWindow && <span className={small}>{windowSummary(callbackWindow)}{callbackWindow.noSunday ? " · no Sunday calls" : ""}</span>}
          </div>
        )}
        {callbackClash && (
          <Callout tone="warning" title={`You already have an appointment then: ${dateTime(callbackClash.startsAtUtc, agentZone, { weekday: true, clock: "12h" })} your time, ${callbackClash.durationMinutes || 30} minutes.`} />
        )}
        {/* LA-2.10-1: an optional note, stored on the callback (callback_note). */}
        <div>
          <label htmlFor="callback-note" className={cn(fieldLabel, "block")}>Note <span className="font-normal text-[var(--muted)]">(optional)</span></label>
          <textarea id="callback-note" rows={2} maxLength={1000} className={cn(fieldClass, "h-auto py-2")} value={callbackNote} onChange={(event) => setCallbackNote(event.target.value)} placeholder="What to pick up on when you call back." />
        </div>
        {!eligibility?.timezone && <p className="m-0 text-xs leading-[1.5] text-[var(--error-ink)]">Add a state to this lead to book a callback — it sets the timezone.</p>}
      </ScheduleDialog>

      {pendingDnc && (
        <div className="rounded-xl border border-[var(--border)] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-4" role="alertdialog" aria-label="Confirm do not call">
          <p className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">Add this number to the do-not-call list?</p>
          <p className={cn(body14, "mt-1")}>It goes on your agency&rsquo;s internal list permanently and this lead is closed.</p>
          <div className="mt-2 flex gap-2">
            {/* Focused on open: Enter confirms, Escape cancels (LA-2.9-9). */}
            <Button type="button" autoFocus disabled={working} onClick={() => void disposition(DNC_OUTCOME)}>Record do not call</Button>
            <Button type="button" variant="ghost" disabled={working} onClick={() => setPendingDnc(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {pendingReturn && (
        <div className="rounded-xl border border-[var(--border)] p-4" role="alertdialog" aria-label={`Confirm ${outcomeLabel(pendingReturn).toLowerCase()}`}>
          <p className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Record {outcomeLabel(pendingReturn).toLowerCase()}?</p>
          <p className={cn(body14, "mt-1")}>Closes this lead; it is not dialed again.</p>
          <p className={cn(small, "mt-1", panel.returnWindow?.claimable ? "text-[var(--success-ink)]" : undefined)}>{returnWindowLine(panel.returnWindow)}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" autoFocus disabled={working} onClick={() => void disposition(pendingReturn)}>Record {outcomeLabel(pendingReturn).toLowerCase()}</Button>
            <Button type="button" variant="ghost" disabled={working} onClick={() => setPendingReturn(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {dispositionError && <p role="alert" className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{dispositionError}</p>}
    </div>
  ) : null;

  // The lead you are on, above the queue table.
  const current = <div className="bg-[var(--brand-50)]/40 shadow-[inset_3px_0_0_var(--primary)]"><DialerLeadColumn d={dialer} readOnly={readOnly} call={callButton}>{callArea}</DialerLeadColumn></div>;
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 text-xs leading-[1.5] font-semibold text-[var(--body)] tabular-nums";

  return (
    /* The list is the page (Dialer A round 2, owner 2026-10-27): one centred column. The lead you
       are on opens in place at the head of the list — its facts, the call and the outcome — and the
       rest of the queue (or the search results) follows as rows. */
    <div className="flex w-full min-w-0 flex-col gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)]">
      <PageHeader
        title="Dialer"
        actions={canCheckNumber || !readOnly ? (
          <>
            {/* Owners and producers (sales.use), as the check route admits; a setter dials what the queue serves. */}
            {canCheckNumber && <Button type="button" variant="outline" onClick={() => setCheckOpen(true)}><ShieldCheck aria-hidden="true" />Check a number</Button>}
            {/* Auto-next: serve the next lead as soon as an outcome is recorded (on by default). */}
            {!searchMode && !readOnly && (
              <Button type="button" variant="outline" onClick={() => setAutoNext(!autoNext)} aria-pressed={autoNext} title={autoNext ? "The next lead is served as soon as you record an outcome." : "After an outcome the screen clears; serve the next lead when you are ready."} className={autoNext ? "border-[var(--primary)] text-[var(--accent-ink)]" : undefined}>
                <Zap aria-hidden="true" />Auto-next {autoNext ? "on" : "off"}
              </Button>
            )}
            {!readOnly && <Button data-guide="dialer-next" type="button" onClick={() => void serveNext()} disabled={serving || Boolean(attempt)} title={attempt ? "Finish this call first" : undefined}>
              {serving ? "Serving…" : "Serve next lead"}
            </Button>}
          </>
        ) : null}
      />
      {canCheckNumber && <DialerPreflightDialog open={checkOpen} onOpenChange={setCheckOpen} readOnly={readOnly} />}

      {readOnly && <Callout tone="info" title="Read-only access — review only, no calls." />}

      {/* Today and the priority filter, one row above the list; the search and the campaign live in
          the queue table's toolbar (owner 2026-10-29). */}
      {(stats || !searchMode) && <div className="flex flex-wrap items-center gap-2">
        {/* Your own calls today, from midnight in the agency's timezone. */}
        {stats && (
          <span className="flex flex-wrap items-center gap-1.5" title={`Your calls since midnight ${zoneShort(stats.zone) || stats.zone}. A contact is a recorded outcome that was a conversation.`}>
            <span className={chip}><Phone aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{stats.dials.toLocaleString()} {stats.dials === 1 ? "dial" : "dials"}</span>
            <span className={chip}><User aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{stats.contacts.toLocaleString()} {stats.contacts === 1 ? "contact" : "contacts"}</span>
            <span className={chip}>{stats.contactRate === null ? "no contact rate yet" : `${Math.round(stats.contactRate)}% contact rate`}</span>
          </span>
        )}
        {!searchMode && <QueuePriorityChips d={dialer} />}
      </div>}

      {/* Outcomes on the left, the list in the middle, the lead's notes on the right; the two
          side columns run the full height of the screen and stay put while the list scrolls. */}
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
      <aside data-guide="disposition-open" aria-label="Call outcome" className={cn(card, "flex flex-col gap-3 p-4 max-lg:order-2 lg:h-full lg:w-[300px] lg:shrink-0 lg:overflow-y-auto")}>
        {outcomePanel ?? <p className={cn(small, "m-0")}>The outcomes appear here when a lead is open.</p>}
      </aside>
      {/* The middle column (owner 2026-10-29): the lead you are on, then the queue as a table that
          fills what is left of the column and pages the rest, so neither the page nor the card scrolls. */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 max-lg:order-1 lg:h-full lg:min-h-0">
        <section className={cn(card, "overflow-hidden lg:min-h-0 lg:overflow-y-auto")} aria-label="Lead on your screen">
          {current}
        </section>
        <DialerQueueTable d={dialer} readOnly={readOnly} />
      </div>
      <aside aria-label="Lead notes" className="flex min-w-0 flex-col max-lg:order-3 lg:h-full lg:w-[320px] lg:shrink-0">
        {panel && !isSetter
          ? <DialerLeadNotes key={panel.lead.id} leadId={panel.lead.id} canWrite={!readOnly} />
          : <div className={cn(card, "h-full p-4")}><p className={cn(small, "m-0")}>{isSetter ? "Lead notes are kept by the agents who sell; your notes go on the booking." : "The lead's notes appear here when a lead is open."}</p></div>}
      </aside>
      </div>

      {/* LA-2.23-5 · below 1024px: the number and the call's next step, stuck to the bottom of the
          screen whatever is open above it. Once the call has started, every outcome is one pick
          away in the same bar. */}
      {panel && !readOnly && nextStep && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden" role="region" aria-label="Call bar">
          {phoneLabel
            ? <span className="shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{phoneLabel}</span>
            : <span className={small}>No phone number</span>}
          <span className="min-w-0 flex-1" />
          {nextStep === "call" && needsDnc && <Button type="button" variant="outline" onClick={() => void checkDnc()} disabled={checkingDnc || !callReady} title={!callReady ? blockers[0] : undefined}><ShieldCheck aria-hidden="true" />{checkingDnc ? "Checking…" : "DNC / TCPA check"}</Button>}
          {nextStep === "call" && !needsDnc && <Button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={working || !callReady} title={!callReady ? blockers[0] : undefined}>{searchMode ? "Log return call" : working ? "Calling…" : "Call"}</Button>}
          {nextStep === "read" && <Button type="button" variant="outline" onClick={() => void confirmRead()} disabled={working || panel.disclosure.blocking}>I read the disclosure</Button>}
          {nextStep === "dial" && <Button type="button" onClick={() => void dial()} disabled={!eligibility?.allowed || !panel.lead.phone || working}>{working ? "Checking…" : "Start call"}</Button>}
          {nextStep === "outcome" && (
            <select
              aria-label="Record the outcome"
              className={cn(toolbarControl, "min-w-0 max-w-[60%]")}
              value=""
              disabled={working}
              onChange={(event) => {
                const key = event.target.value;
                if (!key) return;
                choose(key);
                // A choice that asks one more question opens it in the lead's card.
                requestAnimationFrame(() => document.getElementById("dialer-disposition")?.scrollIntoView({ block: "nearest" }));
              }}
            >
              <option value="">Record outcome…</option>
              {outcomes.map((item) => <option key={item.key} value={item.key}>{outcomeButtonLabel(item)}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One outcome tile (Dialer A round 2, 2026-10-27): its icon, the label and its key, in a grid so
 * every outcome is one glance and one key away. Interested is filled; Do not call is red.
 */
function OutcomeButton({ icon: Icon, label: text, hotkey, tone, pressed, disabled, onClick }: { icon: LucideIcon; label: string; hotkey: string | null; tone: "primary" | "danger" | "default"; pressed?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed || undefined}
      aria-keyshortcuts={hotkey ?? undefined}
      className={cn(
        "flex h-full min-h-9 w-full items-center gap-2.5 rounded-lg border px-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        tone === "primary"
          ? "border-transparent bg-primary text-primary-foreground hover:bg-[var(--accent-hover)]"
          : tone === "danger"
            ? "border-[var(--border)] bg-[var(--surface)] text-[var(--error-ink)] hover:bg-[var(--error-surface)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]",
        pressed && "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--ink)]",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {hotkey && <kbd aria-hidden="true" className="shrink-0 rounded-[4px] border border-current px-1.5 font-sans text-xs leading-[1.4] font-semibold opacity-60">{hotkey}</kbd>}
    </button>
  );
}
