"use client";

import type { ReactNode } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Callout } from "@/components/app/settings/primitives";
import { productLineLabel } from "@/lib/format/productLine";
import { agoLabel } from "@/lib/format/ago";
import { cn } from "@/lib/utils";
import { attemptOfCeiling, consentLabel, dncExemptionLine, localClock, minuteLabel, priorityForTier, shortDate, sourceLabel, SUPPRESSION_LISTS, windowClosedLabel, zoneShort } from "@/lib/dialerScripts/display";
import { body14, label, small, value } from "@/components/app/dialer/model";
import type { useDialer } from "@/components/app/dialer/use-dialer";
import { useNow } from "@/components/app/applications/outcome/use-now";
import { useState } from "react";
import { ChevronDown, Clock, Flame, Lock, MapPin, Megaphone, Package, Phone, Repeat, ShieldAlert, ShieldCheck, Store, Tag, User, type LucideIcon } from "lucide-react";

/** One fact as an icon and a few words; the full sentence is its tooltip. */
function Fact({ icon: Icon, children, title, tone = "neutral" }: { icon: LucideIcon; children: ReactNode; title?: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <span title={title} className={cn(
      "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs leading-[1.5] font-semibold",
      tone === "good" ? "bg-[var(--success-surface)] text-[var(--success-ink)]"
        : tone === "warn" ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]"
        : tone === "bad" ? "bg-[var(--error-surface)] text-[var(--error-ink)]"
        : "bg-[var(--surface-alt)] text-[var(--body)]",
    )}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The lead you are on, opened in place in the Dialer's list (Dialer A round 2, owner 2026-10-27):
 * who, where they came from as icon chips, whether they may be called as ticks, then the call and
 * the outcome (`children`, drawn by the workspace), then the history. Every fact the three-column
 * screen showed is still here; most of it moved into tooltips and the Details / History toggles.
 */
/** `call`: the Call button (and Book appointment), drawn on the right of the facts. */
export function DialerLeadColumn({ d, readOnly, call, children }: { d: ReturnType<typeof useDialer>; readOnly: boolean; call?: ReactNode; children?: ReactNode }) {
  const now = useNow();
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const { searchMode, panel, panelError, loading, served, serving, serveNext, emptyReason, loadingPanel, eligibility, callReady, reasonParts, stateName, stackHits, phoneLabel, cityState, disclosureUnapproved } = d;

  if (panelError) return <div className="p-4"><Callout tone="error" title={`Could not load this lead: ${panelError}`} /></div>;
  if (loading || loadingPanel) return <div aria-label="Lead"><SectionLoading rows={5} columns={4} label={loading ? "Serving your next lead" : "Loading call guidance"} /></div>;
  if (!panel) {
    return (
      <EmptyState
        title={searchMode ? "Open a search result" : "No lead on your screen"}
        hint={searchMode ? "Pick a lead from the results." : emptyReason ?? (readOnly ? "Read-only access does not serve leads." : "Serve the next lead, or pick one from the list below.")}
        action={!searchMode && !readOnly ? <Button type="button" onClick={() => void serveNext()} disabled={serving}>{serving ? "Serving…" : "Serve next lead"}</Button> : undefined}
      />
    );
  }

  const name = panel.lead.fullName ?? panel.lead.firstName;
  const servedHere = Boolean(served && served.leadId === panel.lead.id);
  const priority = served?.tierName && servedHere ? priorityForTier(served.tierName) : null;
  const licence = eligibility?.licence ?? null;
  const dncBad = eligibility?.dncCheck === "unavailable" || eligibility?.dncCheck === "suppressed" || eligibility?.suppression === "suppressed";
  const windowOpen = panel.window ? panel.window.allowed : eligibility?.reason !== "outside_window";
  // Why this lead and the lock you hold (LA-2.8), on hover only (owner 2026-10-27: no line of text for it).
  const why = servedHere && served
    ? `Served to you${served.tierName ? ` · ${served.tierName.replaceAll("_", " ")}` : ""}: ${[reasonParts.join(" · ") || served.selectionReason || "from the queue", served.lockedUntil ? `locked to you until ${new Date(served.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "held by you"].join(" · ")}`
    : reasonParts.length > 0 ? `Last chosen: ${reasonParts.join(" · ")}` : undefined;

  return (
    <article aria-label="Lead" className="@container flex flex-col gap-4 p-5">
      {/* The lead's facts on the left; the Call button on the right, centred on them (owner 2026-10-27).
          In a card narrower than that needs (the middle column above the queue table, 2026-10-29) the
          button sits right under the name and number at full width, ahead of the chips, so it stays in
          view when the card gives its height to the queue. */}
      <div className="flex min-w-0 flex-col gap-4 @2xl:flex-row @2xl:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-4 @max-2xl:contents">
      {/* Who: the name, the number, and their place, clock, age and attempt as icons. */}
      <div className="flex items-start gap-4">
        <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]" aria-hidden="true">
          {(name ?? "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-title-md leading-[1.21] font-semibold tracking-[-0.02em] text-[var(--ink)]">{name}</h2>
            {priority && <Fact icon={Flame} tone={priority === "High" ? "bad" : priority === "Medium" ? "warn" : "neutral"} title={why}>{priority}</Fact>}
          </div>
          <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)] tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]"><Phone aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{phoneLabel ?? "No phone number"}</span>
            <span className="inline-flex items-center gap-1.5" title="Where they are"><MapPin aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{cityState || "state missing"}</span>
            <span className="inline-flex items-center gap-1.5" title="Their local time"><Clock aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{eligibility?.timezone ? `${localClock(eligibility.checkedAt, eligibility.timezone)} their time (${zoneShort(eligibility.timezone)})` : "Local time unknown"}</span>
            {panel.lead.age && <span className="inline-flex items-center gap-1.5" title="Age"><User aria-hidden="true" className="size-3.5 text-[var(--muted)]" />age {panel.lead.age}</span>}
            <span className="inline-flex items-center gap-1.5" title="Attempts"><Repeat aria-hidden="true" className="size-3.5 text-[var(--muted)]" />{attemptOfCeiling(panel.lead.attemptsMade ?? 0, panel.lead.attemptCeiling).toLowerCase()}</span>
          </p>
        </div>
      </div>

      {/* Where the lead came from: four chips. */}
      <div className="flex flex-wrap items-center gap-1.5 @max-2xl:order-2" aria-label="Where this lead came from">
        <Fact icon={Megaphone} title="Campaign">{panel.campaign?.name ?? "No campaign"}</Fact>
        <Fact icon={Store} title="Vendor">{panel.campaign?.vendorName ?? "No vendor"}</Fact>
        <Fact icon={Tag} title="Source">{panel.campaign ? sourceLabel(panel.campaign.leadType) : "—"}</Fact>
        <Fact icon={Package} title="Product">{productLineLabel(panel.lead.productCode)}</Fact>
      </div>
      {/* The setter's notes for this booking stay: they are what the agent says next. */}
      {servedHere && served?.appointmentNotes && <p className={cn(body14, "m-0 @max-2xl:order-2")}><span className="font-semibold text-[var(--ink)]">Setter notes: </span>{served.appointmentNotes}</p>}

      {/* May they be called: one tick per rule; Details opens every check and the suppression stack. */}
      <section aria-label="Eligibility and compliance" className="flex flex-col gap-2 @max-2xl:order-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Fact icon={panel.consent.hasCertificate ? ShieldCheck : ShieldAlert} tone={panel.consent.hasCertificate ? "good" : "warn"} title={`Consent on file: ${consentLabel(panel.consent)}`}>Consent</Fact>
          <Fact icon={dncBad ? ShieldAlert : ShieldCheck} tone={dncBad ? "bad" : "good"} title={eligibility?.dncCheck === "unavailable" ? "Your stored lists could not be read · dialing refused" : "Checked when you call"}>DNC</Fact>
          <Fact icon={licence && licence.status !== "live" ? ShieldAlert : ShieldCheck} tone={licence ? (licence.status === "live" ? "good" : "bad") : "neutral"} title={licence ? (licence.message ?? `${licence.state} licence ${licence.status}`) : "Checked when you call"}>{licence ? `${licence.state} licence` : "Licence"}</Fact>
          <Fact icon={windowOpen ? Clock : Lock} tone={windowOpen ? "good" : "bad"} title="The calling window, in the customer's time">
            {panel.window
              ? panel.window.allowed && panel.window.endMinute !== null ? `Open till ${minuteLabel(panel.window.endMinute)}` : windowClosedLabel(panel.window.reason, panel.window.startMinute, panel.window.zone)
              : eligibility?.reason === "outside_window" ? "Window closed" : "Window"}
          </Fact>
          <Fact icon={!panel.disclosure.configured || disclosureUnapproved ? ShieldAlert : ShieldCheck} tone={!panel.disclosure.configured ? "bad" : disclosureUnapproved ? "warn" : "good"} title="The state's disclosure wording">{!panel.disclosure.configured ? "No disclosure" : disclosureUnapproved ? "Placeholder disclosure" : "Disclosure"}</Fact>
          <button type="button" onClick={() => setComplianceOpen((open) => !open)} aria-expanded={complianceOpen} aria-controls="dialer-compliance-detail" className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
            Details<ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", complianceOpen && "rotate-180")} />
          </button>
          <span className="sr-only">{callReady ? "Allowed" : "Blocked"}</span>
        </div>
        {complianceOpen && <div id="dialer-compliance-detail" className="rounded-xl bg-[var(--surface-alt)] p-4">
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3">
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

          {/* The state's wording, folded behind one toggle (owner 2026-10-27: not on the card). It is
              one click away, never removed: the Call click still records it on the attempt, and a
              placeholder text is still flagged by the Disclosure tick. */}
          {panel.disclosure.configured && (
            <div className="flex flex-col gap-2 @max-2xl:order-2">
              <button type="button" onClick={() => setDisclosureOpen((open) => !open)} aria-expanded={disclosureOpen} aria-controls="dialer-disclosure" className="inline-flex h-7 w-fit items-center gap-1 rounded-full border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)]">
                {`${stateName ?? panel.disclosure.state} disclosure`}<ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", disclosureOpen && "rotate-180")} />
              </button>
              {disclosureOpen && <p id="dialer-disclosure" className="m-0 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-surface)]/40 px-4 py-3 text-sm leading-[1.5] tracking-[-0.02em] whitespace-pre-line text-[var(--body)]">{panel.disclosure.requiredText}</p>}
            </div>
          )}
      </div>
      {call && <div className="flex shrink-0 flex-col items-stretch gap-2 @max-2xl:order-1">{call}</div>}
      </div>

      {!panel.disclosure.configured && (
        <div className="rounded-xl border border-[var(--border)] border-l-[3px] border-l-[var(--error)] px-4 py-3">
          <p className={label}>Required disclosure · {panel.disclosure.state || "unknown state"}</p>
          <p className="mt-1.5 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">{panel.disclosure.requiredText}</p>
        </div>
      )}
        {children}

      {/* A recycle pass (20260925706500): the angle it is being called on, and its script. */}
      {panel.recycle && (
        <div>
          <p className={cn(small, "font-semibold text-[var(--ink)]")}>Recycled · angle: {panel.recycle.angle}{panel.recycle.recycledAt ? <span className="font-normal text-[var(--muted)]"> · {shortDate(panel.recycle.recycledAt)}</span> : null}</p>
          {panel.recycle.script && <p className={cn(body14, "mt-1 whitespace-pre-line")}>{panel.recycle.script}</p>}
        </div>
      )}

    </article>
  );
}
