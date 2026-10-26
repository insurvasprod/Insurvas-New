"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedPager, PagedProvider } from "@/components/ui/paged";
import { Callout, st, pillTone } from "@/components/app/settings/primitives";
import { productLineLabel } from "@/lib/format/productLine";
import { agoLabel } from "@/lib/format/ago";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { attemptOfCeiling, consentLabel, dncExemptionLine, localClock, minuteLabel, shortDate, slotLabel, sourceLabel, SUPPRESSION_LISTS, windowClosedLabel, zoneShort } from "@/lib/dialerScripts/display";
import { barHead, barTitle, body14, card, h2, label, small, value } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";
import { useNow } from "@/components/app/applications/outcome/use-now";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** Lifted from dialer-workspace.tsx (UX-6) unchanged; state comes from useDialer. */
export function DialerLeadColumn({ d, readOnly }: { d: ReturnType<typeof useDialer>; readOnly: boolean }) {
  const now = useNow();
  const [complianceOpen, setComplianceOpen] = useState(false);
  const { searchMode, panel, panelError, attempt, loading, confirmed, dialled, served, serving, serveNext, emptyReason, outcomeLabel, loadingPanel, eligibility, blockers, callReady, customerZone, slotFacts, reasonParts, stateName, stackHits, campaignLine, phoneLabel, cityState, disclosureUnapproved } = d;
  return (
    <>
    {/* ── centre: the lead ────────────────────────────────────────────── */}
    <div className="contents min-w-0 flex-1 flex-col gap-4 lg:flex lg:min-h-0 lg:overflow-y-auto lg:pr-1">
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
            hint={searchMode ? "Pick a lead from the results." : emptyReason ?? (readOnly ? "Read-only access does not serve leads." : "Serve the next lead, or pick one from the queue.")}
            action={!searchMode && !readOnly ? <Button type="button" onClick={() => void serveNext()} disabled={serving}>{serving ? "Serving…" : "Serve next lead"}</Button> : undefined}
          />
        </section>
      )}

      {panel && <>
        <section className={cn(card, "p-5 max-lg:order-1")} aria-label="Lead">
          {/* The lead, as Dialer A draws it (2026-10-25): who, where, their clock and the attempt, with
              the tier it was served from. The call's buttons moved to the call dock on the right. */}
          <div className="flex items-center gap-4">
            <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]" aria-hidden="true">
              {(panel.lead.fullName ?? panel.lead.firstName ?? "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-title-md leading-[1.21] font-semibold tracking-[-0.02em] text-[var(--ink)]">{panel.lead.fullName ?? panel.lead.firstName}</h2>
                {served?.tierName && served.leadId === panel.lead.id && <StatusChip tone="neutral" dot>{served.tierName.replaceAll("_", " ")}</StatusChip>}
              </div>
              <p className="mt-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)] tabular-nums">
                {[
                  phoneLabel ?? "No phone number",
                  panel.lead.age ? `age ${panel.lead.age}` : null,
                  cityState || "state missing",
                  eligibility?.timezone ? `${localClock(eligibility.checkedAt, eligibility.timezone)} local time (${zoneShort(eligibility.timezone)})` : "Local time unknown",
                  attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling).toLowerCase(),
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          {!searchMode && <CallSteps step={!attempt ? 0 : !confirmed ? 1 : !dialled ? 2 : 3} />}
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
          {/* A served lead: why the queue chose it and the lock you hold (LA-2.8), one line here since
              the "Served to you" card left the queue column (2026-10-06); the setter's notes with it. */}
          {served && served.leadId === panel.lead.id && (
            <>
              <p className={cn(small, "mt-2")}>
                <span className="font-semibold text-[var(--ink)]">Served to you{served.tierName ? ` · ${served.tierName.replaceAll("_", " ")}` : ""}: </span>
                {[reasonParts.join(" · ") || served.selectionReason || "from the queue", served.lockedUntil ? `locked to you until ${new Date(served.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "held by you"].join(" · ")}
              </p>
              {served.appointmentNotes && <p className={cn(body14, "mt-2")}><span className="font-semibold text-[var(--ink)]">Setter notes: </span>{served.appointmentNotes}</p>}
            </>
          )}

          {!panel.disclosure.configured && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className={label}>Required disclosure · {panel.disclosure.state || "unknown state"}</p>
              <p className="mt-1.5 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{panel.disclosure.requiredText}</p>
            </div>
          )}
          {/* The state's wording appears once a call is being prepared, with the read-and-record step
              that unlocks the dial (confirm-to-dial kept). It is not shown before then (user decision
              2026-10-06); a placeholder text is still flagged under Eligibility & compliance. */}
          {attempt && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className={label}>{panel.disclosure.configured ? `${stateName ?? panel.disclosure.state} requires this wording · cannot be hidden` : `Required disclosure · ${panel.disclosure.state || "unknown state"}`}</p>
              <p className="mt-1.5 text-base leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
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
          {/* Collapsible (user decision 2026-10-06). Closed, it keeps the verdict, a one-line summary
              and every blocker in view: what stops the dial is never folded away. */}
          <h2 className={cn(h2, "m-0")}>
            <button type="button" onClick={() => setComplianceOpen((open) => !open)} aria-expanded={complianceOpen} aria-controls="dialer-compliance-detail" className="flex w-full items-center gap-3 text-left">
              <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", !complianceOpen && "-rotate-90")} />
              <span className="flex-1">Eligibility &amp; compliance</span>
              <StatusChip tone={pillTone(callReady ? "success" : "error")} dot>{callReady ? "Allowed" : "Blocked"}</StatusChip>
            </button>
          </h2>
          {!complianceOpen && (
            <p className={cn(small, "mt-1.5 truncate pl-7")}>
              {[
                `Consent: ${consentLabel(panel.consent)}`,
                !panel.disclosure.configured ? "No disclosure on file" : disclosureUnapproved ? "Disclosure is a placeholder" : "Disclosure approved",
                eligibility?.licence ? (eligibility.licence.status === "live" ? `${eligibility.licence.state} licence live` : `Licence ${eligibility.licence.status === "refused" ? "refused" : "unchecked"}`) : null,
                panel.window ? (panel.window.allowed && panel.window.endMinute !== null ? `Window open until ${minuteLabel(panel.window.endMinute)}` : "Window closed") : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
          {/* The licence's refusal is the server's sentence here, with every other reason the
              call cannot be placed. */}
          {blockers.length > 0 && (
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {blockers.map((line) => <li key={line} className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{line}</li>)}
            </ul>
          )}
          {complianceOpen && <div id="dialer-compliance-detail">
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
                {eligibility?.dncCheck === "unavailable" ? "Your stored lists could not be read · dialing refused" : "Checked when you call"}
                {panel.lastDncCheck && <span className="block font-normal text-[var(--muted)] text-xs">Last: {panel.lastDncCheck.result === "clear" ? "clear" : panel.lastDncCheck.result === "listed" ? "listed, dial refused" : "lists could not be read"} · {agoLabel(Date.parse(panel.lastDncCheck.checkedAt), now)}</span>}
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
                <StatusChip tone="warning" dot>{dncExemptionLine(eligibility.dncExemption)}</StatusChip>
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
                    <dd className={cn("m-0 text-right text-sm leading-[1.5] font-semibold tracking-[-0.02em]", bad ? "text-[var(--error-ink)]" : result === "Clear" ? "text-[var(--success-ink)]" : "text-[var(--muted)]")}>
                      {result}{hit?.addedAt && <span className="block text-xs font-normal text-[var(--muted)]">since {shortDate(hit.addedAt)}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
          </div>}
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
            <PagedProvider>
            <div className="min-w-0 overflow-x-auto">
              <table className={st.table}>
                <thead><tr className={st.headRow}>{["Date / time", "Attempt", "Slot", "Result", "Evidence"].map((head) => <th key={head} scope="col" className={st.th}>{head}</th>)}</tr></thead>
                <PagedBody>
                  {panel.attemptHistory.map((item) => (
                    <tr key={item.id}>
                      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{dateTime(item.attemptedAt, viewerTimeZone(), { clock: "12h" })}</td>
                      <td className={cn(st.td, "tabular-nums")}>{item.attemptNumber}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{slotLabel(item.slot)}</td>
                      <td className={st.td}>{item.disposition ? outcomeLabel(item.disposition) : "In progress"}</td>
                      <td className={st.td}>{item.dialClicked ? "Dial recorded" : "Not dialed"}<span className={st.sub}>{item.disclosureConfirmed ? "Disclosure confirmed" : "Disclosure pending"}</span></td>
                    </tr>
                  ))}
                </PagedBody>
              </table>
            </div>
            {panel.attemptHistory.length > 10 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <PagedPager total={panel.attemptHistory.length} noun="attempts" />
              </div>
            )}
            </PagedProvider>
          )}
        </section>
      </>}
    </div>
    </>
  );
}

const STEPS = ["Call", "Disclosure", "Dial", "Talk and record"];

/** Where the call is: four steps, the done ones in green, the current one lit (Dialer A, 2026-10-25). */
function CallSteps({ step }: { step: number }) {
  return (
    <ol aria-label="Call steps" className="m-0 mt-4 grid list-none grid-cols-4 gap-1.5 p-0">
      {STEPS.map((name, index) => (
        <li
          key={name}
          aria-current={index === step ? "step" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-[1.5] font-semibold",
            index < step ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : index === step ? "bg-[var(--surface-alt)] text-[var(--ink)] ring-1 ring-[var(--border-strong)]" : "text-[var(--muted)]",
          )}
        >
          <span className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border text-xs", index <= step ? "border-current" : "border-[var(--border-strong)]")} aria-hidden="true">{index + 1}</span>
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ol>
  );
}
