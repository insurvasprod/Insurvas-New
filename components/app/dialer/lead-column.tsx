"use client";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Callout, Pill, control, st } from "@/components/app/settings/primitives";
import { productLineLabel } from "@/lib/format/productLine";
import { agoLabel } from "@/lib/format/ago";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { attemptOfCeiling, consentLabel, dncExemptionLine, localClock, minuteLabel, shortDate, slotLabel, sourceLabel, SUPPRESSION_LISTS, windowClosedLabel, zoneShort } from "@/lib/dialerScripts/display";
import { unapprovedDisclosureLine } from "@/lib/dialerScripts/disclosureStatus";
import { Kbd, SECTION_LABELS, barHead, barTitle, body14, card, fieldLabel, h2, label, scriptSections, small, value } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";
import { useNow } from "@/components/app/applications/outcome/use-now";

/** Lifted from dialer-workspace.tsx (UX-6) unchanged; state comes from useDialer. */
export function DialerLeadColumn({ d, readOnly }: { d: ReturnType<typeof useDialer>; readOnly: boolean }) {
  const now = useNow();
  const { canAuthor, searchMode, panel, panelError, attempt, loading, working, confirmed, dialled, rebuttal, setRebuttal, editingScript, setEditingScript, draftSections, setDraftSections, served, emptyReason, rebuttalQuery, setRebuttalQuery, outcomeLabel, saveCurrentScript, prepareAttempt, confirmRead, dial, loadingPanel, eligibility, blockers, callReady, customerZone, slotFacts, reasonParts, stateName, stackHits, campaignLine, visibleRebuttals, phoneLabel, cityState, disclosureUnapproved } = d;
  return (
    <>
    {/* ── centre: the lead ────────────────────────────────────────────── */}
    <div className="contents min-w-0 flex-1 flex-col gap-4 lg:flex">
      {panelError && <div className="max-lg:order-1"><Callout tone="error" title={`Could not load this lead: ${panelError}`} /></div>}
      {(loading || loadingPanel) && (
        <section className={cn(card, "max-lg:order-1")} aria-label="Lead">
          <SectionLoading rows={6} columns={4} label={loading ? "Serving your next lead" : "Loading call guidance"} />
        </section>
      )}
      {!loading && !panel && !loadingPanel && !panelError && (
        <section className={cn(card, "max-lg:order-1")}>
          <EmptyState
            title={searchMode ? "Open a search result" : "No lead on your screen"}
            hint={searchMode ? "Choose a lead from the results to see its compliance checks and script." : emptyReason ?? (readOnly ? "Read-only access does not serve leads." : "Serve the next lead, or pick one from the queue.")}
          />
        </section>
      )}

      {panel && <>
        <section className={cn(card, "p-5 max-lg:order-1")} aria-label="Lead">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <h2 className="m-0 text-[24px] leading-[1.21] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</h2>
              <p className="mt-1.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)] tabular-nums">
                {[
                  phoneLabel ?? "No phone number",
                  panel.lead.age ? `age ${panel.lead.age}` : null,
                  cityState || "state missing",
                  eligibility?.timezone ? `${localClock(eligibility.checkedAt, eligibility.timezone)} local time (${zoneShort(eligibility.timezone)})` : "Local time unknown",
                  attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling).toLowerCase(),
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
            {!attempt ? (
              <Button type="button" onClick={() => void prepareAttempt(searchMode)} disabled={readOnly || working || !callReady} title={!callReady ? blockers[0] : undefined} aria-keyshortcuts={readOnly ? undefined : "C"}>
                {readOnly ? "Read-only account" : searchMode ? "Log inbound return call" : "Click to call"}{!readOnly && <Kbd>C</Kbd>}
              </Button>
            ) : dialled ? (
              <Button type="button" disabled title="The call has started; record what happened.">Call started</Button>
            ) : (
              <Button type="button" disabled={!confirmed || !eligibility?.allowed || !panel.lead.phone || working} aria-describedby="dial-status" aria-keyshortcuts="D" onClick={() => void dial()}>
                {working ? "Checking…" : eligibility?.allowed ? "Start call" : "Dialing blocked"}<Kbd>D</Kbd>
              </Button>
            )}
          </div>
          <dl className="m-0 mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              ["Campaign", panel.campaign?.name ?? "—"],
              ["Vendor", panel.campaign?.vendorName ?? "—"],
              ["Source", panel.campaign ? sourceLabel(panel.campaign.leadType) : "—"],
              ["Product", productLineLabel(panel.lead.productCode)],
            ].map(([term, detail]) => (
              <div key={term} className="min-w-0"><dt className={label}>{term}</dt><dd className={cn(value, "m-0")}>{detail}</dd></div>
            ))}
          </dl>
          {campaignLine && <p className={cn(small, "mt-3 tabular-nums")}>{campaignLine}</p>}
          {/* The reason the queue last chose a lead that is on screen without being served (a search or a pick elsewhere). */}
          {(!served || served.leadId !== panel.lead.id) && reasonParts.length > 0 && (
            <p className={cn(small, "mt-2")}><span className="font-semibold text-[var(--ink)]">Last chosen: </span>{reasonParts.join(" · ")}</p>
          )}

          {!panel.disclosure.configured && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className={label}>Required disclosure · {panel.disclosure.state || "unknown state"}</p>
              <p className="mt-1.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{panel.disclosure.requiredText}</p>
            </div>
          )}
          {/* D15: the wording on file is still the seeded placeholder, not compliance-approved.
              Dialing is not blocked by it (the user's decision); it is said plainly instead. */}
          {disclosureUnapproved && <div className="mt-4"><Callout tone="warning" title={unapprovedDisclosureLine(stateName ?? panel.disclosure.state)} /></div>}
          {/* The wording is on screen as soon as the lead loads, and cannot be hidden. Recording
              that it was read is still what unlocks the dial (confirm-to-dial kept). */}
          {panel.disclosure.configured && !attempt && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className={label}>{stateName ?? panel.disclosure.state} requires this wording · cannot be hidden</p>
              <p className="mt-1.5 text-[16px] leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>
            </div>
          )}
          {attempt && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className={label}>{panel.disclosure.configured ? `${stateName ?? panel.disclosure.state} requires this wording · cannot be hidden` : `Required disclosure · ${panel.disclosure.state || "unknown state"}`}</p>
              <p className="mt-1.5 text-[16px] leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => void confirmRead()} disabled={readOnly || working || confirmed || panel.disclosure.blocking} aria-keyshortcuts={confirmed ? undefined : "R"}>
                  {confirmed ? "Read and recorded" : "I read this disclosure"}{!confirmed && <Kbd>R</Kbd>}
                </Button>
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

        <section className={cn(card, "p-5 max-lg:order-3")} aria-label="Eligibility and compliance">
          <div className="flex items-center justify-between gap-4">
            <h2 className={h2}>Eligibility &amp; compliance</h2>
            <Pill tone={callReady ? "success" : "error"} dot>{callReady ? "Allowed" : "Blocked"}</Pill>
          </div>
          {/* The licence's refusal is the server's sentence here, with every other reason the
              call cannot be placed. */}
          {blockers.length > 0 && (
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {blockers.map((line) => <li key={line} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{line}</li>)}
            </ul>
          )}
          <dl className="m-0 mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="min-w-0"><dt className={label}>Consent on file</dt><dd className={cn(value, "m-0")}>{consentLabel(panel.consent)}</dd></div>
            {/* D15: whether the state's wording is the approved text or still the placeholder. */}
            <div className="min-w-0">
              <dt className={label}>State disclosure</dt>
              <dd className={cn(value, "m-0", (!panel.disclosure.configured || disclosureUnapproved) && "text-[var(--error-ink)]")}>
                {!panel.disclosure.configured ? "None on file · dialing refused" : disclosureUnapproved ? "Placeholder · not approved" : "Approved wording on file"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className={label}>DNC</dt>
              <dd className={cn(value, "m-0", eligibility?.dncCheck === "unavailable" && "text-[var(--error-ink)]")}>
                {eligibility?.dncCheck === "unavailable" ? "No DNC vendor is answering · dialing refused" : "Checked when you call"}
                {panel.lastDncCheck && <span className="block font-normal text-[var(--muted)] text-[12px]">Last: {panel.lastDncCheck.result === "clear" ? "clear" : panel.lastDncCheck.result === "listed" ? "listed, dial refused" : "no vendor answered"} · {agoLabel(Date.parse(panel.lastDncCheck.checkedAt), now)}</span>}
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
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <p className={label}>Suppression stack · re-checked at dial</p>
            {/* LA-2.3-3: every use of an exemption is audited; the agent sees it on the dial. */}
            {eligibility?.dncExemption && (
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Pill tone="warning" dot>{dncExemptionLine(eligibility.dncExemption)}</Pill>
                {eligibility.dncExemption.certificateUrl && <a href={eligibility.dncExemption.certificateUrl} target="_blank" rel="noreferrer" className={cn(small, "font-semibold text-[var(--ink)] underline underline-offset-2")}>Consent certificate</a>}
              </p>
            )}
            <dl className="m-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1">
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
          </div>
        </section>

        <section className={cn(card, "flex flex-col overflow-hidden max-lg:order-4")} aria-label="Suggested script">
          <div className={cn(barHead, "flex-wrap")}>
            <span className={barTitle}>Suggested script</span>
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{panel.script.version ? `Version ${panel.script.version}` : "Default script"}</Pill>
              {canAuthor && <Button type="button" variant="outline" onClick={() => setEditingScript((open) => !open)}>{editingScript ? "Cancel" : "Edit"}</Button>}
              {canAuthor && <Button type="button" variant="outline" onClick={() => void saveCurrentScript()} disabled={!editingScript || working} title={!editingScript ? "Edit the script first" : undefined}>Save new version</Button>}
            </span>
          </div>
          {editingScript ? (
            <div className="space-y-3 px-5 py-4">
              {/* LA-2.23: an unknown variable resolves to nothing, so the editor names the ones that exist. */}
              <p className={small}>
                Variables: <code>{"{{first_name}}"}</code>, <code>{"{{state}}"}</code>, <code>{"{{age}}"}</code>, <code>{"{{agent_name}}"}</code>, <code>{"{{agency_name}}"}</code>, <code>{"{{product}}"}</code>, <code>{"{{consent_date}}"}</code> — anything else is replaced with nothing rather than shown.
              </p>
              {scriptSections.map((key) => (
                <div key={key}>
                  <label htmlFor={`script-${key}`} className={fieldLabel}>{SECTION_LABELS[key]}</label>
                  <textarea id={`script-${key}`} className={cn(control, "h-auto min-h-24 py-2 text-[14px]")} value={draftSections[key] ?? ""} onChange={(event) => setDraftSections((current) => ({ ...current, [key]: event.target.value }))} />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-4">
              <p className="m-0 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">&ldquo;{String(panel.script.sections.opening ?? "")}&rdquo;</p>
              {scriptSections.slice(1).map((key) => (
                <div key={key} className="mt-3">
                  <p className={label}>{SECTION_LABELS[key]}</p>
                  <p className={cn(body14, "mt-1")}>{String(panel.script.sections[key] ?? "")}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={cn(card, "flex flex-col overflow-hidden max-lg:order-5")} aria-label="Rebuttals">
          <div className={cn(barHead, "flex-wrap")}>
            <span className={barTitle}>Rebuttals</span>
            {/* LA-2.23-3: search the library by objection, response or key ("number", "spouse"). */}
            <input
              type="search"
              aria-label="Search rebuttals"
              placeholder="Search rebuttals"
              className={cn(toolbarControl, "w-full min-w-0 sm:w-[220px]")}
              value={rebuttalQuery}
              onChange={(event) => setRebuttalQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setRebuttalQuery(""); } }}
            />
          </div>
          <div className="grid gap-2 p-4">
            {visibleRebuttals.map((item) => {
              // One match while searching opens by itself: the answer is one keystroke away.
              const open = rebuttal === item.id || (rebuttalQuery.trim() !== "" && visibleRebuttals.length === 1);
              return (
                <button key={item.id} type="button" onClick={() => setRebuttal(rebuttal === item.id ? null : item.id)} aria-expanded={open} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left hover:bg-[var(--canvas)]">
                  <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.label}</span>
                  {open && <span className={cn(body14, "mt-1 block")}>{item.body}</span>}
                </button>
              );
            })}
            {visibleRebuttals.length === 0 && <p className={cn(small, "m-0 py-2 text-center")} role="status">No rebuttal matches &ldquo;{rebuttalQuery.trim()}&rdquo;.</p>}
          </div>
        </section>

        <section className={cn(card, "flex flex-col overflow-hidden max-lg:order-7")} aria-label="Recent call history">
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
                  : slotFacts.tried.map((row) => `${slotLabel(row.slot)} (${dateTime(row.attemptedAt, customerZone ?? viewerTimeZone(), { weekday: true, clock: "12h" })}${row.disposition ? `, ${outcomeLabel(row.disposition).toLowerCase()}` : ""})`).join(" · ")}
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
                      <td className={st.td}>{item.disposition ? outcomeLabel(item.disposition) : "In progress"}</td>
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
    </>
  );
}
