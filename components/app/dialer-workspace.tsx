"use client";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { Callout, Pill } from "@/components/app/settings/primitives";
import { DialerPreflightDialog } from "@/components/app/dialer-preflight";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { windowSummary } from "@/lib/callbacks/windowFacts";
import { productLineLabel } from "@/lib/format/productLine";
import { cn } from "@/lib/utils";
import { dateTime } from "@/lib/format/dates";
import { attemptOfCeiling, formatUsPhone, localClock, priorityForTier, returnWindowLine, selectionReasonParts, zoneShort } from "@/lib/dialerScripts/display";
import { APPLICATION_OUTCOME, outcomeButtonLabel, outcomeHotkey } from "@/lib/dialerScripts/outcomes";
import { CALLBACK_OUTCOME, DNC_OUTCOME, FILTERS, Kbd, PRIORITY_TONE, type QueueFilter, barHead, barTitle, body14, card, fieldClass, fieldLabel, h2, instantInZone, label, leadName, slotOptionLabel, small } from "@/components/app/dialer/model";
import { useDialer } from "@/components/app/dialer/use-dialer";
import { DialerLeadColumn } from "@/components/app/dialer/lead-column";
import { useNow } from "@/components/app/applications/outcome/use-now";

export function DialerWorkspace({ readOnly = false, role = "producer", canCheckNumber = false, requestedLeadId = null }: { readOnly?: boolean; role?: string; canCheckNumber?: boolean; requestedLeadId?: string | null }) {
  const dialer = useDialer({ readOnly, role, canCheckNumber, requestedLeadId });
  const now = useNow();
  const { isSetter, search, setSearch, searchMode, searching, selectedId, panel, attempt, loading, working, dialled, served, serving, queue, queueError, queueFilter, setQueueFilter, picking, pickRefusals, calendar, bookAgent, setBookAgent, pendingCallback, setPendingCallback, callbackAt, setCallbackAt, pendingDnc, setPendingDnc, pendingReturn, setPendingReturn, bookSlot, setBookSlot, bookNotes, setBookNotes, booking, starting, checkOpen, setCheckOpen, outcomeOpen, setOutcomeOpen, dispositionError, callbackNote, setCallbackNote, dispositions, outcomeLabel, agentZone, bookAppointment, startApplication, resetCall, selectLead, searchLeads, clearLeadSearch, visibleLeads, serveNext, serveNextNow, pickLead, prepareAttempt, confirmRead, dial, choose, disposition, eligibility, outcomes, primaryCount, blockers, callReady, stats, customerZone, callbackInstant, callbackWindow, callbackInWindow, callbackInFuture, callbackClash, stateName, bookableSlots, quickOptions, phoneLabel, nextStep } = dialer;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Dialer"
        actions={canCheckNumber || !readOnly ? (
          <>
            {/* Owners and producers (sales.use), as the check route admits; a setter dials what the queue serves. */}
            {canCheckNumber && <Button type="button" variant="outline" onClick={() => setCheckOpen(true)}>Check a number</Button>}
            {!readOnly && <Button type="button" variant="outline" onClick={() => void serveNext()} disabled={serving || Boolean(attempt)} title={attempt ? "Finish this call first" : undefined}>
              {serving ? "Serving…" : "Serve next lead"}
            </Button>}
          </>
        ) : null}
      />
      {canCheckNumber && <DialerPreflightDialog open={checkOpen} onOpenChange={setCheckOpen} readOnly={readOnly} />}

      {readOnly && <Callout tone="info" title="Read-only access: review guidance and compliance evidence without starting or changing a call." />}

      {/* LA-2.23-5 · the phone number and the outcome buttons stay on screen. From 1024px the three
          columns sit side by side and the outcome column is sticky, with the number at its head.
          Below 1024px the column wrappers dissolve (`contents`) and the cards are reordered: the
          lead, then the outcome, then compliance, the script and rebuttals, and the queue last —
          and a call bar holding the number and the next step sticks to the bottom of the screen. */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        {/* ── left: the queue ─────────────────────────────────────────────── */}
        <div className="contents min-w-0 flex-col gap-4 lg:flex lg:w-[300px] lg:shrink-0">
          <section className={cn(card, "flex flex-col overflow-hidden max-lg:order-8")} aria-label={searchMode ? "Search results" : "Priority queue"}>
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
              <div className="border-b border-[var(--border)] px-3 py-2.5">
                <select aria-label="Filter the queue by priority" className={cn(toolbarControl, "w-full")} value={queueFilter} onChange={(event) => setQueueFilter(event.target.value as QueueFilter)}>
                  {FILTERS.map((filter) => <option key={filter.key} value={filter.key}>{filter.label}</option>)}
                </select>
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
                    <button key={lead.id} type="button" onClick={() => selectLead(lead.id)} aria-pressed={selected} className={cn("block w-full border-t border-[var(--border)] px-3.5 py-2.5 text-left first:border-t-0", selected ? "bg-[var(--brand-50)] shadow-[inset_2px_0_0_var(--primary)]" : "bg-transparent hover:bg-[var(--canvas)]")}>
                      <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{leadName(lead.values)}</span>
                      <span className={cn(small, "mt-0.5 block")}>{product} · {state} · {formatUsPhone(String(lead.values.phone ?? lead.values.phone_number ?? "")) || "No phone"}</span>
                    </button>
                  );
                })}
                {visibleLeads.length === 0 && <p className={cn(small, "px-3.5 py-6 text-center")}>No leads match that identity search.</p>}
              </>
            ) : (
              <>
                {served && panel && panel.lead.id === served.leadId && (
                  <div aria-current="true" className="border-t border-[var(--border)] bg-[var(--brand-50)] px-3.5 py-2.5 shadow-[inset_2px_0_0_var(--primary)] first:border-t-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</span>
                      {served.tierName && <Pill tone={PRIORITY_TONE[priorityForTier(served.tierName)]} dot>{priorityForTier(served.tierName)}</Pill>}
                    </span>
                    <span className={cn(small, "mt-0.5 block tabular-nums")}>
                      {attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling)}{eligibility?.timezone ? ` · ${localClock(eligibility.checkedAt, eligibility.timezone)} local` : ""} · on your screen
                    </span>
                  </div>
                )}
                {(attempt || readOnly) && queue?.available && queue.rows.length > 0 && (
                  <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-2")}>{readOnly ? "Read-only access: picking a lead claims it, so the list is for looking only." : "Finish this call before picking another lead."}</p>
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
                        <span className="min-w-0 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{row.name ?? "Unnamed lead"}</span>
                        <Pill tone={PRIORITY_TONE[priority]} dot>{priority}</Pill>
                      </span>
                      <span className={cn(small, "mt-0.5 block tabular-nums")}>
                        {picking === row.workItemId ? "Serving…" : `Attempt ${row.attemptsMade + 1}${row.localTime ? ` · ${row.localTime} local` : ""} · in window${row.assignedToYou ? " · assigned to you" : ""}`}
                      </span>
                      {refusal && <span id={`pick-${row.workItemId}`} role="alert" className="mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{refusal}</span>}
                    </button>
                  );
                })}
                {queue && !queue.available && <p className={cn(small, "border-t border-[var(--border)] px-3.5 py-3")} role="status">{queue.message}</p>}
                {queueError && <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] leading-[1.5] text-[var(--error-ink)]" role="alert">{queueError}</p>}
                {queue?.available && queue.rows.length === 0 && !(served && panel) && (
                  <p className={cn(small, "px-3.5 py-6 text-center")} role="status">{queueFilter === "all" ? queue.emptyReason ?? "Nothing else is servable to you right now." : "Nothing in this priority is servable to you right now."}</p>
                )}
              </>
            )}
          </section>

          {/* The served card: what the server chose and why, and the lock the agent now holds. */}
          {!searchMode && !loading && served && (
            <section className={cn(card, "p-4 max-lg:order-9")} aria-label="Served to you">
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
              <p className={cn(small, "mt-2")}>{served.lockedUntil ? `Locked to you until ${new Date(served.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Held by you."}</p>
            </section>
          )}

          {!isSetter && <form onSubmit={(event) => void searchLeads(event)} className={cn(card, "flex flex-col gap-2 p-4 max-lg:order-10")}>
            <label htmlFor="dialer-search" className={fieldLabel}>Find a lead</label>
            <input id="dialer-search" type="search" className={cn(toolbarControl, "w-full")} placeholder="Name, phone or email" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit" variant="outline" disabled={searching || search.trim().length < 2}>{searching ? "Searching…" : "Search"}</Button>
          </form>}
        </div>

        <DialerLeadColumn d={dialer} readOnly={readOnly} />

        {/* ── right: the outcome ──────────────────────────────────────────── */}
        {/* Sticky from 1024px, with the number at its head, so a long script or an open rebuttal
            never pushes the outcome buttons off screen (LA-2.23-5). */}
        <div className="contents min-w-0 flex-col gap-4 lg:sticky lg:top-[72px] lg:flex lg:max-h-[calc(100vh-88px)] lg:w-[300px] lg:shrink-0 lg:overflow-y-auto">
          {panel && (
            <section id="dialer-disposition" className={cn(card, "p-4 max-lg:order-2")} aria-label="Disposition">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={h2}>Disposition</h2>
                {phoneLabel && <a href={`tel:${panel.lead.phone}`} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums no-underline" aria-label={`Customer's number ${phoneLabel}`}>{phoneLabel}</a>}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {outcomes.slice(0, primaryCount).map((item, index) => {
                  const hotkey = searchMode ? null : outcomeHotkey(index);
                  return (
                    <Button key={item.key} type="button" variant={item.key === APPLICATION_OUTCOME ? "default" : "outline"} className="w-full" onClick={() => choose(item.key)} disabled={!dialled || working} aria-pressed={(pendingCallback && item.key === CALLBACK_OUTCOME) || undefined} aria-keyshortcuts={hotkey ?? undefined}>
                      {outcomeButtonLabel(item)}{hotkey && <Kbd>{hotkey}</Kbd>}
                    </Button>
                  );
                })}
                {searchMode && outcomes.length === 0 && <p className={small}>The inbound return call is archived in Settings › Dispositions, so it cannot be logged here.</p>}
              </div>
              {!searchMode && outcomes.length > primaryCount && (
                <>
                  <p className={cn(label, "mt-4")}>More outcomes</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {outcomes.slice(primaryCount).map((item, offset) => {
                      const hotkey = outcomeHotkey(primaryCount + offset);
                      return (
                        <Button key={item.key} type="button" variant="outline" className={cn("w-full", item.key === DNC_OUTCOME && "text-[var(--error-ink)]")} onClick={() => choose(item.key)} disabled={!dialled || working} aria-pressed={(pendingDnc && item.key === DNC_OUTCOME) || undefined} aria-keyshortcuts={hotkey ?? undefined}>
                          {outcomeButtonLabel(item)}{hotkey && <Kbd>{hotkey}</Kbd>}
                        </Button>
                      );
                    })}
                  </div>
                </>
              )}

              {pendingCallback && (
                <div className="mt-3 space-y-2 rounded-[8px] border border-[var(--border)] p-3" role="group" aria-label="Book the callback">
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
                          ? <Pill tone="neutral">{callbackWindow ? "Choose a time" : "Window not loaded"}</Pill>
                          : callbackInWindow ? <Pill tone="success" dot>Inside the {stateName ?? "customer's"} calling window</Pill>
                          : <Pill tone="error" dot>Outside the {stateName ?? "customer's"} calling window</Pill>}
                        {callbackInFuture === null ? null : callbackInFuture ? <Pill tone="success" dot>In the future</Pill> : <Pill tone="error" dot>In the past</Pill>}
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
                  {!eligibility?.timezone && <p className="text-[12px] leading-[1.5] text-[var(--error-ink)]">This lead has no state on it, so there is no timezone to book against. Add one on the lead first.</p>}
                </div>
              )}

              {pendingDnc && (
                <div className="mt-3 rounded-[8px] border border-[var(--border)] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-3" role="alertdialog" aria-label="Confirm do not call">
                  <p className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">Add this number to the do-not-call list?</p>
                  <p className={cn(body14, "mt-1")}>It goes on your agency&rsquo;s internal list permanently and this lead is closed.</p>
                  <div className="mt-2 flex gap-2">
                    {/* Focused on open: Enter confirms, Escape cancels (LA-2.9-9). */}
                    <Button type="button" autoFocus disabled={working} onClick={() => void disposition(DNC_OUTCOME)}>Record do not call</Button>
                    <Button type="button" variant="ghost" disabled={working} onClick={() => setPendingDnc(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              {pendingReturn && (
                <div className="mt-3 rounded-[8px] border border-[var(--border)] p-3" role="alertdialog" aria-label={`Confirm ${outcomeLabel(pendingReturn).toLowerCase()}`}>
                  <p className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Record {outcomeLabel(pendingReturn).toLowerCase()}?</p>
                  <p className={cn(body14, "mt-1")}>Closes this lead; it is not dialed again.</p>
                  <p className={cn(small, "mt-1", panel.returnWindow?.claimable ? "text-[var(--success-ink)]" : undefined)}>{returnWindowLine(panel.returnWindow)}</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" autoFocus disabled={working} onClick={() => void disposition(pendingReturn)}>Record {outcomeLabel(pendingReturn).toLowerCase()}</Button>
                    <Button type="button" variant="ghost" disabled={working} onClick={() => setPendingReturn(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              {dispositionError && <p role="alert" className="mt-3 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{dispositionError}</p>}
              <p className={cn(small, "mt-3")}>
                {!attempt ? "Record the result after the call starts. Keys: C calls, R records the disclosure, D starts the call." : !dialled ? "Start the call first; the outcome is recorded against it." : searchMode ? "Record the result of this call." : `Record the result. Keys 1–${Math.min(9, dispositions.length)}${dispositions.length >= 10 ? " and 0" : ""} choose a disposition; N serves the next lead.`}
                {searchMode && " An inbound return call does not use one of this lead’s outbound attempts."}
              </p>
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
                  <Button type="button" variant="outline" className="w-full" onClick={() => setOutcomeOpen(true)} disabled={working}>Open call outcome</Button>
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

          {panel && !readOnly && calendar && calendar.agents.length > 0 && (
            <section className={cn(card, "flex flex-col gap-3 p-4 max-lg:order-6")} aria-label="Book an appointment">
              <h2 className={h2}>Book an appointment</h2>
              <div>
                <label htmlFor="book-agent" className={fieldLabel}>Agent</label>
                <select id="book-agent" className={fieldClass} value={bookAgent} onChange={(event) => setBookAgent(event.target.value)}>{calendar.agents.map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name}{agent.timezone ? ` · ${agent.timezone}` : ""}</option>)}</select>
              </div>
              {/* Slot-only (Appointments audit, 2026-09-25): the agent's open slots, in the customer's
                  time first and "= your time" after. Slots outside the customer's published calling
                  window are left out; the server still checks every rule when it books. */}
              <div>
                <label htmlFor="book-slot" className={fieldLabel}>Open times{customerZone ? <> — customer&rsquo;s time ({zoneShort(customerZone)})</> : ""}</label>
                {bookableSlots.length > 0 ? (
                  <select id="book-slot" className={fieldClass} value={bookableSlots.includes(bookSlot) ? bookSlot : ""} onChange={(event) => setBookSlot(event.target.value)}>
                    <option value="">Choose a time</option>
                    {bookableSlots.map((slot) => <option key={slot} value={slot}>{slotOptionLabel(slot, customerZone)}</option>)}
                  </select>
                ) : (
                  <p className={cn(small, "mt-1")} role="status">No open times for this agent in the next 7 days{panel.callbackWindow ? " inside the customer's calling window" : ""}. Choose another agent, or open their calendar.</p>
                )}
              </div>
              <div>
                <label htmlFor="book-notes" className={fieldLabel}>Notes for the agent</label>
                <textarea id="book-notes" rows={3} className={cn(fieldClass, "h-auto py-2")} value={bookNotes} onChange={(event) => setBookNotes(event.target.value)} placeholder="What was discussed, and what to lead with." />
              </div>
              <Button type="button" className="w-full" disabled={!bookAgent || !bookSlot || booking} title={!bookSlot ? "Choose one of the open times first" : undefined} onClick={() => void bookAppointment()}>{booking ? "Booking…" : "Book appointment"}</Button>
            </section>
          )}

          {panel && !readOnly && !isSetter && <section className={cn(card, "portal-dialer-interested flex flex-col gap-3 p-4 max-lg:order-6")} aria-label="They are interested">
            <h2 className={h2}>They are interested</h2>
            <Button type="button" className="w-full" disabled={starting || !panel.lead.workItemId} title={!panel.lead.workItemId ? "Only a lead served to you can start an application" : "Opens the verification panel, prefilled from the list data"} onClick={() => void startApplication()}>{starting ? "Starting…" : "Start application"}</Button>
          </section>}
        </div>

        {/* LA-2.23-5 · below 1024px: the number and the call's next step, stuck to the bottom of the
            screen whatever is open above it. Once the call has started, every outcome is one pick
            away in the same bar. */}
        {panel && !readOnly && nextStep && (
          <div className="sticky bottom-0 z-10 order-last -mx-4 flex items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden" role="region" aria-label="Call bar">
            {phoneLabel
              ? <a href={`tel:${panel.lead.phone}`} className="shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums no-underline">{phoneLabel}</a>
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
