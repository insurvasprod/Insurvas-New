"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Callout, pillTone } from "@/components/app/settings/primitives";
import { DialerPreflightDialog } from "@/components/app/dialer-preflight";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { windowSummary } from "@/lib/callbacks/windowFacts";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";
import { dateTime } from "@/lib/format/dates";
import { attemptOfCeiling, formatUsPhone, localClock, priorityForTier, returnWindowLine, zoneShort } from "@/lib/dialerScripts/display";
import { APPLICATION_OUTCOME, outcomeButtonLabel, outcomeHotkey } from "@/lib/dialerScripts/outcomes";
import { CALLBACK_OUTCOME, DNC_OUTCOME, FILTERS, Kbd, PRIORITY_TONE, barHead, barTitle, body14, card, fieldClass, fieldLabel, instantInZone, label, leadName, small } from "@/components/app/dialer/model";
import { useDialer } from "@/components/app/dialer/use-dialer";
import { DialerLeadColumn } from "@/components/app/dialer/lead-column";
import { useNow } from "@/components/app/applications/outcome/use-now";
import { BookAppointmentDialog } from "@/components/app/dialer/book-appointment-dialog";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";

export function DialerWorkspace({ readOnly = false, role = "producer", canCheckNumber = false, requestedLeadId = null }: { readOnly?: boolean; role?: string; canCheckNumber?: boolean; requestedLeadId?: string | null }) {
  const dialer = useDialer({ readOnly, role, canCheckNumber, requestedLeadId });
  const now = useNow();
  const { isSetter, search, setSearch, searchMode, searching, selectedId, panel, attempt, working, dialled, served, serving, queue, queueError, queueFilter, setQueueFilter, picking, pickRefusals, pendingCallback, setPendingCallback, callbackAt, setCallbackAt, pendingDnc, setPendingDnc, pendingReturn, setPendingReturn, checkOpen, setCheckOpen, outcomeOpen, setOutcomeOpen, dispositionError, callbackNote, setCallbackNote, dispositions, outcomeLabel, agentZone, resetCall, selectLead, searchLeads, clearLeadSearch, visibleLeads, serveNext, serveNextNow, pickLead, prepareAttempt, confirmRead, dial, choose, disposition, eligibility, outcomes, primaryCount, blockers, callReady, stats, customerZone, callbackInstant, callbackWindow, callbackInWindow, callbackInFuture, callbackClash, stateName, quickOptions, phoneLabel, nextStep, confirmed, calendar, autoNext, setAutoNext, clearLead } = dialer;
  const [bookOpen, setBookOpen] = useState(false);
  const canBook = !readOnly && Boolean(calendar && calendar.agents.length > 0);

  return (
    /* From 1024px the dialer fills the screen under the top bar and each column scrolls on its own
       (user decision 2026-10-06); the heights subtract the shell padding, as Partner chat does. */
    <div className="flex w-full min-w-0 flex-col gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)]">
      <PageHeader
        title="Dialer"
        actions={canCheckNumber || !readOnly ? (
          <>
            {/* Owners and producers (sales.use), as the check route admits; a setter dials what the queue serves. */}
            {canCheckNumber && <Button type="button" variant="outline" onClick={() => setCheckOpen(true)}>Check a number</Button>}
            {!readOnly && <Button data-guide="dialer-next" type="button" variant="outline" onClick={() => void serveNext()} disabled={serving || Boolean(attempt)} title={attempt ? "Finish this call first" : undefined}>
              {serving ? "Serving…" : "Serve next lead"}
            </Button>}
          </>
        ) : null}
      />
      {canCheckNumber && <DialerPreflightDialog open={checkOpen} onOpenChange={setCheckOpen} readOnly={readOnly} />}

      {readOnly && <Callout tone="info" title="Read-only access — review only, no calls." />}

      {/* LA-2.23-5 · the phone number and the outcome buttons stay on screen. From 1024px the three
          columns sit side by side and the outcome column is sticky, with the number at its head.
          Below 1024px the column wrappers dissolve (`contents`) and the cards are reordered: the
          lead, then the outcome, then compliance, the script and rebuttals, and the queue last —
          and a call bar holding the number and the next step sticks to the bottom of the screen. */}
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* ── left: the queue ─────────────────────────────────────────────── */}
        <div className="contents min-w-0 flex-col gap-4 lg:flex lg:min-h-0 lg:w-[300px] lg:shrink-0">
          {/* One row, above the queue (2026-10-06), so the queue below keeps the height. */}
          {!isSetter && <form onSubmit={(event) => void searchLeads(event)} className={cn(card, "flex shrink-0 items-center gap-2 p-2.5 max-lg:order-8")} role="search" aria-label="Find a lead">
            <label htmlFor="dialer-search" className="sr-only">Find a lead by name, phone or email</label>
            <input id="dialer-search" type="search" className={cn(toolbarControl, "min-w-0 flex-1")} placeholder="Find a lead: name, phone, email" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit" variant="outline" disabled={searching || search.trim().length < 2}>{searching ? "Searching…" : "Search"}</Button>
          </form>}
          <section className={cn(card, "flex flex-col overflow-hidden max-lg:order-9 lg:min-h-0 lg:flex-1")} aria-label={searchMode ? "Search results" : "Priority queue"}>
            <div className={barHead}>
              <span className={barTitle}>{searchMode ? "Search results" : "Priority queue"}</span>
              <span className={cn(small, "tabular-nums")} title={searchMode ? undefined : "Leads servable to you right now, counted up to 1,000"}>
                {searchMode ? visibleLeads.length : queue?.available ? (queue.capped ? `${queue.cap.toLocaleString()}+` : queue.count.toLocaleString()) : ""}
              </span>
            </div>
            {searchMode ? (
              <div className="flex flex-col gap-2 border-b border-[var(--border)] px-3 py-2.5">
                <p className={small}>Search results are read-only; opening one does not serve or claim the lead.</p>
                <Button type="button" variant="outline" onClick={clearLeadSearch}>Back to queue</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 border-b border-[var(--border)] px-3 py-2.5">
                {/* Your own calls today, from midnight in the agency's timezone. */}
                {stats && (
                  <p className={cn(small, "m-0 tabular-nums")} title={`Your calls since midnight ${zoneShort(stats.zone) || stats.zone}. A contact is a recorded outcome that was a conversation.`}>
                    Today: <strong className="font-semibold text-[var(--ink)]">{stats.dials.toLocaleString()}</strong> {stats.dials === 1 ? "dial" : "dials"} · <strong className="font-semibold text-[var(--ink)]">{stats.contacts.toLocaleString()}</strong> {stats.contacts === 1 ? "contact" : "contacts"} · {stats.contactRate === null ? "no contact rate yet" : <><strong className="font-semibold text-[var(--ink)]">{Math.round(stats.contactRate)}%</strong> contact rate</>}
                  </p>
                )}
                {/* The priority filter as chips (Dialer A, 2026-10-25): every tier one click, no menu to open. */}
                <div role="group" aria-label="Filter the queue by priority" className="flex flex-wrap gap-1.5">
                  {FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setQueueFilter(filter.key)}
                      aria-pressed={queueFilter === filter.key}
                      className={cn("h-7 rounded-full px-2.5 text-xs leading-[1.5] font-semibold transition-colors", queueFilter === filter.key ? "bg-[var(--primary)] text-[var(--on-primary)]" : "bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--ink)]")}
                    >
                      {filter.key === "all" ? "All" : filter.label.replace(/ priority$/, "")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {searchMode ? (
              <>
                {visibleLeads.map((lead) => {
                  const state = String(lead.values.state ?? "State missing");
                  const product = productLineLabel(String(lead.product_line ?? lead.values.product_line ?? lead.values.product ?? ""));
                  const selected = selectedId === lead.id;
                  return (
                    <button key={lead.id} type="button" onClick={() => selectLead(lead.id)} aria-pressed={selected} className={cn("block w-full border-t border-[var(--border)] px-3.5 py-2.5 text-left first:border-t-0", selected ? "bg-[var(--brand-50)] shadow-[inset_2px_0_0_var(--primary)]" : "bg-transparent hover:bg-[var(--canvas)]")}>
                      <span className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{leadName(lead.values)}</span>
                      <span className={cn(small, "mt-0.5 block")}>{product} · {state} · {formatUsPhone(String(lead.values.phone ?? lead.values.phone_number ?? "")) || "No phone"}</span>
                    </button>
                  );
                })}
                {visibleLeads.length === 0 && <NoMatches noun="leads" by="search" onClear={clearLeadSearch} />}
              </>
            ) : (
              <>
                {served && panel && panel.lead.id === served.leadId && (
                  <div aria-current="true" className="border-t border-[var(--border)] bg-[var(--brand-50)] px-3.5 py-2.5 shadow-[inset_2px_0_0_var(--primary)] first:border-t-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</span>
                      {served.tierName && <StatusChip tone={pillTone(PRIORITY_TONE[priorityForTier(served.tierName)])} dot>{priorityForTier(served.tierName)}</StatusChip>}
                    </span>
                    <span className={cn(small, "mt-0.5 block tabular-nums")}>
                      {attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling)}{eligibility?.timezone ? ` · ${localClock(eligibility.checkedAt, eligibility.timezone)} local` : ""} · on your screen
                    </span>
                  </div>
                )}
                {(attempt || readOnly) && queue?.available && queue.rows.length > 0 && (
                  <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-2")}>{readOnly ? "Read-only access — the list is for looking only." : "Finish this call before picking another lead."}</p>
                )}
                {!queue && !queueError && <SectionLoading rows={4} columns={2} label="Loading the queue" />}
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
                      className="block w-full border-t border-[var(--border)] bg-transparent px-3.5 py-2.5 text-left first:border-t-0 hover:bg-[var(--canvas)] disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{row.name ?? "Unnamed lead"}</span>
                        <StatusChip tone={pillTone(PRIORITY_TONE[priority])} dot>{priority}</StatusChip>
                      </span>
                      <span className={cn(small, "mt-0.5 block tabular-nums")}>
                        {picking === row.workItemId ? "Serving…" : `Attempt ${row.attemptsMade + 1}${row.localTime ? ` · ${row.localTime} local` : ""} · in window${row.assignedToYou ? " · assigned to you" : ""}`}
                      </span>
                      {refusal && <span id={`pick-${row.workItemId}`} role="alert" className="mt-1 block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{refusal}</span>}
                    </button>
                  );
                })}
                {queue && !queue.available && <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-3")} role="status">{queue.message}</p>}
                {queueError && <p className="border-t border-[var(--border)] px-3.5 py-3 text-xs leading-[1.5] text-[var(--error-ink)]" role="alert">{queueError}</p>}
                {queue?.available && queue.rows.length === 0 && !(served && panel) && (
                  queueFilter === "all"
                    ? <p className={cn(small, "px-3.5 py-6 text-center")} role="status">{queue.emptyReason ?? "Nothing else is servable to you right now."}</p>
                    : <div className="flex flex-col items-center gap-2 px-3.5 py-6 text-center" role="status"><p className={cn(small, "m-0")}>Nothing in this priority is servable to you right now.</p><Button type="button" variant="outline" onClick={() => setQueueFilter("all")}>Show every priority</Button></div>
                )}
              </>
            )}
            </div>
          </section>

        </div>

        <DialerLeadColumn d={dialer} readOnly={readOnly} />

        {/* ── right: the outcome ──────────────────────────────────────────── */}
        {/* From 1024px a full-height column, with the number at its head, so nothing pushes the
            outcome buttons off screen (LA-2.23-5). Book an appointment moved to a pop-up beside
            Start call, and the "They are interested" card left: the Interested outcome below starts
            the application (2026-10-06). */}
        <div className="contents min-w-0 flex-col gap-4 lg:flex lg:min-h-0 lg:w-[320px] lg:shrink-0">
          {panel && (
            <section id="dialer-disposition" className={cn(card, "flex flex-col overflow-hidden max-lg:order-2 lg:min-h-0 lg:flex-1")} aria-label="Disposition">
              {/* The call dock (Dialer A, 2026-10-25): the number, then ONE button that is always the call's
                  next step — Click to call, I read the disclosure, Start call — and, when the call cannot
                  be placed, why, in words (the audit: a reason in a disabled button's tooltip reaches
                  nobody on a phone or a screen reader). Below 1024px the call bar at the foot of the
                  screen carries these steps, so here they are desktop only. */}
              <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--border)] p-4">
                <div className="text-center">
                  <p className={cn(small, "m-0")}>{dialled ? "On the call with" : "Calling"}</p>
                  <p className="m-0 text-2xl leading-[1.25] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums" aria-label={phoneLabel ? `Customer's number ${phoneLabel}` : undefined}>{phoneLabel ?? "No phone number"}</p>
                </div>
                <div className="flex flex-col gap-2 max-lg:hidden">
                  {!attempt ? (
                    <Button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={readOnly || working || !callReady} aria-describedby={!callReady ? "dialer-blockers" : undefined} aria-keyshortcuts={readOnly ? undefined : "C"} className="h-12 w-full text-base">
                      {readOnly ? "Read-only account" : searchMode ? "Log inbound return call" : "Click to call"}{!readOnly && <Kbd>C</Kbd>}
                    </Button>
                  ) : !confirmed ? (
                    <Button type="button" onClick={() => void confirmRead()} disabled={readOnly || working || confirmed || panel.disclosure.blocking} aria-keyshortcuts="R" className="h-12 w-full text-base">
                      I read this disclosure<Kbd>R</Kbd>
                    </Button>
                  ) : dialled ? (
                    <Button type="button" disabled title="The call has started; record what happened." className="h-12 w-full text-base">Call started</Button>
                  ) : (
                    <Button type="button" disabled={!confirmed || !eligibility?.allowed || !panel.lead.phone || working} aria-describedby="dial-status" aria-keyshortcuts="D" onClick={() => void dial()} className="h-12 w-full text-base">
                      {working ? "Checking…" : eligibility?.allowed ? "Start call" : "Dialing blocked"}<Kbd>D</Kbd>
                    </Button>
                  )}
                  {!attempt && !readOnly && !callReady && blockers.length > 0 && (
                    <ul id="dialer-blockers" className="m-0 list-none space-y-0.5 p-0 text-center">
                      {blockers.map((line) => <li key={line} className="text-xs leading-[1.5] font-semibold text-[var(--error-ink)]">{line}</li>)}
                    </ul>
                  )}
                  {/* Book an appointment opens once the call is being prepared (2026-10-06). */}
                  {attempt && canBook && (
                    <Button type="button" variant="outline" onClick={() => setBookOpen(true)}><CalendarPlus aria-hidden="true" />Book appointment</Button>
                  )}
                </div>
                <BookAppointmentDialog d={dialer} open={bookOpen} onOpenChange={setBookOpen} />
              </div>
              <div className="flex flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {/* Where the call is, in one line: the buttons stay disabled until the call starts. */}
              <p className={cn("m-0 flex items-center gap-2 rounded-md px-3 py-2 text-xs leading-[1.5] font-semibold", dialled ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--muted)]")} role="status">
                <span className={cn("size-1.5 shrink-0 rounded-full", dialled ? "bg-[var(--success)]" : "bg-[var(--muted)]")} aria-hidden="true" />
                {!attempt ? (searchMode ? "Log the return call to record its outcome." : "Click to call to begin.") : !dialled ? "Start the call, then record what happened here." : "Call in progress · choose the outcome."}
              </p>
              <div role="group" aria-label="Outcome" className="flex flex-col gap-1.5">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <p className={cn(label, "m-0")}>Outcome</p>
                  {/* Auto-next: serve the next lead as soon as an outcome is recorded (on by default). */}
                  {!searchMode && !readOnly && (
                    <button type="button" onClick={() => setAutoNext(!autoNext)} aria-pressed={autoNext} title={autoNext ? "The next lead is served as soon as you record an outcome." : "After an outcome the screen clears; serve the next lead when you are ready."} className={cn("h-7 rounded-full border px-2.5 text-xs leading-[1.5] font-semibold transition-colors", autoNext ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--ink)]")}>
                      Auto-next {autoNext ? "on" : "off"}
                    </button>
                  )}
                </div>
                {outcomes.slice(0, searchMode ? outcomes.length : primaryCount).map((item, index) => (
                  <OutcomeButton key={item.key} label={outcomeButtonLabel(item)} hotkey={searchMode ? null : outcomeHotkey(index)} tone={item.key === APPLICATION_OUTCOME ? "primary" : "default"} pressed={pendingCallback && item.key === CALLBACK_OUTCOME} disabled={!dialled || working} onClick={() => choose(item.key)} />
                ))}
                {searchMode && outcomes.length === 0 && <p className={small}>Restore the inbound return call in Settings › Dispositions to log it here.</p>}
              </div>
              {!searchMode && outcomes.length > primaryCount && (
                <div role="group" aria-label="More outcomes" className="flex flex-col gap-1.5">
                  <p className={cn(label, "m-0 mb-0.5")}>More outcomes</p>
                  {outcomes.slice(primaryCount).map((item, offset) => (
                    <OutcomeButton key={item.key} label={outcomeButtonLabel(item)} hotkey={outcomeHotkey(primaryCount + offset)} tone={item.key === DNC_OUTCOME ? "danger" : "default"} pressed={pendingDnc && item.key === DNC_OUTCOME} disabled={!dialled || working} onClick={() => choose(item.key)} />
                  ))}
                </div>
              )}

              {pendingCallback && (
                <div className="space-y-2 rounded-[8px] border border-[var(--border)] p-3" role="group" aria-label="Book the callback">
                  {/* LA-2.10-1 quick options: in the customer's time, inside their window. Focus lands
                      on the first, so Enter books "later today" with no mouse and no typing. */}
                  {quickOptions.length > 0 && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Quick callback times">
                      {quickOptions.map((option, index) => (
                        <Button key={option.key} type="button" size="sm" variant={callbackAt === option.local ? "default" : "outline"} autoFocus={index === 0} aria-pressed={callbackAt === option.local} title={customerZone ? `${dateTime(instantInZone(option.local, customerZone) ?? now, customerZone, { weekday: true, clock: "12h" })} ${zoneShort(customerZone)}` : undefined} onClick={() => setCallbackAt(option.local)}>
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {/* The customer's own clock, not the agent's: "Tuesday at 2pm" is a promise made to the person who answered. */}
                  <label htmlFor="callback-at" className={cn(fieldLabel, "block")}>Call back at — {eligibility?.timezone ? <>customer&rsquo;s time ({zoneShort(eligibility.timezone)})</> : "the customer's local time"}</label>
                  <input id="callback-at" type="datetime-local" className={cn(toolbarControl, "w-full")} value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} />
                  <p className={small}>Their local time is currently {eligibility?.timezone ? localClock(now, eligibility.timezone) : "unknown"} · yours {localClock(now, agentZone)} {zoneShort(agentZone)}.</p>
                  {/* The Callbacks page's conversion line and checks (lib/callbacks/windowFacts.ts). Advisory: the server re-checks the window when it books. */}
                  {callbackInstant !== null && customerZone && (
                    <p className={cn(small, "tabular-nums")}>
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
                  <div className="flex gap-2">
                    <Button type="button" disabled={!callbackAt || !eligibility?.timezone || working || callbackInWindow === false || callbackInFuture === false} title={callbackInWindow === false ? "Outside the customer's calling window" : callbackInFuture === false ? "That time has passed for the customer" : undefined} onClick={() => void disposition(CALLBACK_OUTCOME, { callback_local: callbackAt, customer_timezone: eligibility?.timezone, ...(callbackNote.trim() ? { callback_note: callbackNote.trim() } : {}) })}>Book the callback</Button>
                    <Button type="button" variant="ghost" disabled={working} onClick={() => { setPendingCallback(false); setCallbackAt(""); setCallbackNote(""); }}>Cancel</Button>
                  </div>
                  {!eligibility?.timezone && <p className="text-xs leading-[1.5] text-[var(--error-ink)]">Add a state to this lead to book a callback — it sets the timezone.</p>}
                </div>
              )}

              {pendingDnc && (
                <div className="rounded-[8px] border border-[var(--border)] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3" role="alertdialog" aria-label="Confirm do not call">
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
                <div className="rounded-[8px] border border-[var(--border)] p-3" role="alertdialog" aria-label={`Confirm ${outcomeLabel(pendingReturn).toLowerCase()}`}>
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
              <p className={cn(small, "m-0")}>
                {!dialled ? "Keys: C calls, R records the disclosure, D starts the call." : searchMode ? "Record the result of this call." : `Keys 1–${Math.min(9, dispositions.length)}${dispositions.length >= 10 ? " and 0" : ""} choose a disposition; N serves the next lead.`}
                {searchMode && " An inbound return call does not use one of this lead’s outbound attempts."}
              </p>
              </div>
              {/* The structured outcome (the walk, an outcome, callback details) for a served lead's
                  work item. Owners and producers; a setter keeps the buttons above.
                  With a dialled attempt open it is CALL mode (user decision 2026-09-24): the outcome
                  is recorded against that attempt by the dialer's own route, so the attempt closes,
                  the cadence advances and the verification gate runs, and the walked answers are
                  stored with the attempt. With no attempt it is the inbound path, for a conversation
                  that did not start here. Hidden while an attempt is prepared but not dialled, as
                  the buttons above are disabled then. */}
              {!isSetter && !searchMode && panel.lead.workItemId && (!attempt || dialled) && (
                <div className="shrink-0 border-t border-[var(--border)] p-3">
                  <Button data-guide="disposition-open" type="button" variant="outline" className="w-full" onClick={() => setOutcomeOpen(true)} disabled={working}>Open call outcome</Button>
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
                if (autoNext) void serveNextNow();
                else clearLead();
              }}
            />
          )}

        </div>

        {/* LA-2.23-5 · below 1024px: the number and the call's next step, stuck to the bottom of the
            screen whatever is open above it. Once the call has started, every outcome is one pick
            away in the same bar. */}
        {panel && !readOnly && nextStep && (
          <div className="sticky bottom-0 z-10 order-last -mx-4 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden" role="region" aria-label="Call bar">
            {phoneLabel
              ? <span className="shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{phoneLabel}</span>
              : <span className={small}>No phone number</span>}
            <span className="min-w-0 flex-1" />
            {nextStep === "call" && <Button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={working || !callReady} title={!callReady ? blockers[0] : undefined}>{searchMode ? "Log return call" : "Click to call"}</Button>}
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
                  // A choice that asks one more question opens it in the Disposition card.
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
    </div>
  );
}

/**
 * One outcome: a full-width row, the label on the left and its key on the right, so a column of
 * outcomes reads as a list and every key lines up (user decision 2026-10-06; they were pills of
 * mixed widths that wrapped). The Interested outcome is filled, Do not call is red.
 */
function OutcomeButton({ label: text, hotkey, tone, pressed, disabled, onClick }: { label: string; hotkey: string | null; tone: "primary" | "danger" | "default"; pressed?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed || undefined}
      aria-keyshortcuts={hotkey ?? undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md border px-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        tone === "primary"
          ? "border-transparent bg-primary text-primary-foreground hover:bg-[var(--accent-hover)]"
          : tone === "danger"
            ? "border-[var(--border)] bg-[var(--surface)] text-[var(--error-ink)] hover:bg-[var(--error-surface)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]",
        pressed && "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--ink)]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {hotkey && <kbd aria-hidden="true" className="shrink-0 rounded-[4px] border border-current px-1.5 font-sans text-xs leading-[1.4] font-semibold opacity-60">{hotkey}</kbd>}
    </button>
  );
}