"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, ChevronLeft, Loader2, Pencil } from "lucide-react";

import { Callout, pillTone } from "@/components/app/settings/primitives";
import { CallerCard, callerFacts, elapsed } from "@/components/app/inbound/caller-card";
import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";
import { callHref } from "@/components/app/inbound/use-floor";
import { SamePersonPrompt, type SamePersonCheck } from "@/components/app/same-person-prompt";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { PageLoading } from "@/components/ui/page-loading";
import { withFrom } from "@/lib/applications/backLink";
import { notify } from "@/lib/notify";
import type { TemplateField } from "@/lib/templates/constants";
import type { VerificationState } from "@/lib/verification/progress";
import { cn } from "@/lib/utils";
import { useRevealReason } from "@/components/app/reveal-reason-dialog";

type PanelField = TemplateField & { state: VerificationState; old_value: unknown; new_value: unknown; confirmed_at: string | null };
type PanelSection = { section_key: string; label: string; sort_order: number; fields: PanelField[] };
type HistoryEntry = { id: string; kind: "claimed" | "confirmed" | "corrected" | "outstanding"; fieldKey: string | null; at: string; actorName: string; isYou: boolean };
type Context = { claim: { at: string | null; byName: string | null; isYou: boolean }; partnerName: string | null; callStartedAt: string | null; history: HistoryEntry[] };
type Panel = {
  session: { id: string; progress_percentage: number; completed_at: string | null; started_at: string; last_actor_id: string | null };
  workItem: { leadId: string; productLine: string };
  lead: { values: Record<string, unknown>; carrier_id?: string | null; carrier_state?: string | null };
  template: { product_name: string; definition_version?: number };
  sections: PanelSection[];
  requiredCount: number;
  visibleCount: number;
  /** Keys whose values arrive masked ("•••• 4021"); the full value comes from ./reveal. */
  sensitiveKeys?: string[];
  context?: Context | null;
  /** The existing-customer pre-flight stored on the lead (LA-1.24), for the "Same person?" prompt. */
  preflight?: SamePersonCheck | null;
};
type HandoffContext = { canOffer: boolean; licensedAgents: Array<{ id: string; name: string; role: "owner" | "producer" }> };

function isEmpty(value: unknown) { return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0); }
function displayValue(value: unknown) { return Array.isArray(value) ? value.join(", ") : isEmpty(value) ? "nothing" : String(value); }
function sameValue(a: unknown, b: unknown) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (isEmpty(a) && isEmpty(b)); }
function inputValue(value: unknown, type: TemplateField["type"]) { if (type === "multi_select") return Array.isArray(value) ? value : []; if (type === "boolean") return typeof value === "boolean" ? String(value) : ""; if (type === "currency" && typeof value === "number") return String(value / 100); return value === null || value === undefined ? "" : String(value); }
/* ── local controls: a text link and a 16px editor that looks like a field ─ */

const b = {
  link: "cursor-pointer border-0 bg-transparent p-0 text-xs leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
};
const FLAT = "box-border w-full rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--ink)_3%,transparent)] px-2.5 text-base leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] hover:border-[var(--border-strong)] focus:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
// Owner 2026-10-28: no grey type on this screen — headings and labels read in the body and ink colours.
const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--body)]";

/** One detail's state, said the way the agent acts on it (owner 2026-10-27: self-explanatory rows). */
const STATE_LOOK: Record<VerificationState, { label: string; mark: string; row: string }> = {
  outstanding: { label: "To check", mark: "border-[1.5px] border-dashed border-[var(--border-strong)] text-[var(--muted)]", row: "" },
  confirmed: { label: "Confirmed", mark: "bg-[var(--primary)] text-[var(--on-primary)]", row: "bg-[color-mix(in_srgb,var(--success)_6%,transparent)]" },
  corrected: { label: "Changed", mark: "bg-[var(--warning)] text-white", row: "bg-[color-mix(in_srgb,var(--warning)_7%,transparent)]" },
};

function FieldEditor({ id, field, value, onChange, disabled, placeholder }: { id: string; field: TemplateField; value: unknown; onChange: (value: unknown) => void; disabled: boolean; placeholder: string }) {
  if (field.type === "long_text") return <textarea id={id} className={cn(FLAT, "min-h-9 resize-y py-1.5")} value={inputValue(value, field.type) as string} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "single_select" || field.type === "boolean") {
    return (
      <select id={id} className={cn(FLAT, "h-9 cursor-pointer")} value={inputValue(value, field.type) as string} disabled={disabled} onChange={(event) => onChange(field.type === "boolean" ? event.target.value === "" ? undefined : event.target.value === "true" : event.target.value)}>
        <option value="">{placeholder || "Choose…"}</option>
        {field.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : field.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "multi_select") {
    return (
      <div id={id} role="group" aria-label={field.label} className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1">
        {field.options.map((option) => (
          <label key={option} className="inline-flex items-center gap-2 text-base leading-[1.5] tracking-[-0.02em] text-[var(--ink)]">
            <input type="checkbox" checked={Array.isArray(value) && value.includes(option)} disabled={disabled} onChange={(event) => onChange([...(Array.isArray(value) ? value : []).filter((item) => item !== option), ...(event.target.checked ? [option] : [])])} />
            {option}
          </label>
        ))}
      </div>
    );
  }
  const htmlType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
  return <input id={id} className={cn(FLAT, "h-9")} type={htmlType} value={inputValue(value, field.type) as string} placeholder={placeholder} disabled={disabled} autoComplete="off" onChange={(event) => { const raw = event.target.value; onChange(field.type === "number" ? raw === "" ? undefined : Number(raw) : field.type === "currency" ? raw === "" ? undefined : Math.round(Number(raw) * 100) : raw); }} />;
}

/**
 * LA-1.11-7: a section is complete when every required field in it is confirmed or corrected (and,
 * for a section with no required field, when every field is). A complete section folds to its
 * header, so what is left to ask is what is on screen. An empty section is never "complete".
 */
function sectionComplete(fields: Array<{ is_required: boolean; state: VerificationState }>) {
  if (fields.length === 0) return false;
  const required = fields.filter((field) => field.is_required);
  const counted = required.length ? required : fields;
  return counted.every((field) => field.state !== "outstanding");
}

/**
 * `onUnderwrite` / `onFinish` (owner 2026-10-28): inside the call page, which draws the step bar and
 * changes step in place — the panel then has no back link, title or bar of its own, fills the screen's
 * height and scrolls inside its card. Without them it is the standalone screen it was.
 */
export function VerificationPanel({ workItemId, readOnly, canHandoff, onUnderwrite, onFinish, onBack }: { workItemId: string; readOnly: boolean; canHandoff: boolean; onUnderwrite?: (caseId: string) => void; onFinish?: () => void; /** Back to Caller profile. */ onBack?: () => void }) {
  const embedded = Boolean(onFinish);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [revealed, setRevealed] = useState<Record<string, unknown>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const { ask: askRevealReason, dialog: revealReasonDialog } = useRevealReason();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // Rows answered on screen whose save is still on its way (see quick()).
  const [optimistic, setOptimistic] = useState<Record<string, VerificationState>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [handoffContext, setHandoffContext] = useState<HandoffContext | null>(null);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // "Same person?" (Module 1 simplified): a re-check replaces the stored result; an existing customer
  // holds Continue to underwriting until the agent says they checked.
  const [preflight, setPreflight] = useState<SamePersonCheck | null | undefined>(undefined);
  const [rechecking, setRechecking] = useState(false);
  const [customerChecked, setCustomerChecked] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  // Sections the agent opened again after they completed. Everything else complete stays folded.
  const [reopened, setReopened] = useState<Record<string, boolean>>({});

  /** Correction drafts start from the stored values, except masked ones: a mask is never a value. */
  const seedDrafts = useCallback((next: Panel) => {
    const masked = new Set(next.sensitiveKeys ?? []);
    return Object.fromEntries(Object.entries(next.lead.values ?? {}).filter(([key]) => !masked.has(key)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load verification"); setLoading(false); return; }
    setPanel(body); setDrafts(seedDrafts(body)); setRevealed({}); setError(""); setLoading(false);
  }, [seedDrafts, workItemId]);
  // This initial load is the server-backed session resume point after a dropped call.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canHandoff) return;
    fetch(`/api/app/inbound/handoff?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load licensed agents");
      setHandoffContext(body);
      setHandoffTarget(body.licensedAgents?.[0]?.id ?? "");
    }).catch((error: unknown) => setHandoffError(error instanceof Error ? error.message : "Could not load licensed agents"));
  }, [canHandoff, workItemId]);

  // "Since claim" counts up from the open call record's start.
  const callStartedAt = panel?.context?.callStartedAt ?? null;
  useEffect(() => {
    if (!callStartedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [callStartedAt]);

  /**
   * "It's right" and "Check again" answer at once (owner 2026-10-28: speed-clicking down the list was
   * slow and blocked the next row). The row shows its new state immediately; the saves go to the server
   * one after another in click order, so a later reply never undoes an earlier click, and a failed save
   * puts its row back with the reason.
   */
  function quick(field: PanelField, state: "confirmed" | "outstanding") {
    const key = field.field_key;
    setOptimistic((current) => ({ ...current, [key]: state }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch("/api/app/inbound/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId, field_key: key, state }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body?.error ?? "Could not save this field";
          setFieldErrors((current) => ({ ...current, [key]: message }));
          notify.block(message);
        } else setPanel(body.panel as Panel);
      } catch {
        setFieldErrors((current) => ({ ...current, [key]: "Not saved — check the connection and press it again." }));
      } finally {
        setOptimistic((current) => { const next = { ...current }; delete next[key]; return next; });
      }
    });
  }

  async function update(field: PanelField, state: VerificationState) {
    if (state !== "corrected") { quick(field, state); return; }
    const key = field.field_key;
    const sensitive = (panel?.sensitiveKeys ?? []).includes(key);
    if (state === "corrected" && sensitive && isEmpty(drafts[key])) {
      setFieldErrors((current) => ({ ...current, [key]: "Type the corrected value first, or reveal the current one to edit it." }));
      return;
    }
    setSaving(key); setFieldErrors((current) => ({ ...current, [key]: "" }));
    // Only a correction carries a value; confirming reads the stored one on the server.
    const payload: Record<string, unknown> = { work_item_id: workItemId, field_key: key, state };
    if (state === "corrected") payload.value = drafts[key];
    const response = await fetch("/api/app/inbound/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { const message = body?.error ?? "Could not save this field"; setFieldErrors((current) => ({ ...current, [key]: message })); notify.block(message); return; }
    const next = body.panel as Panel;
    setPanel(next);
    // Only this field's draft follows the server; unsaved edits in other rows are kept.
    const fresh = seedDrafts(next);
    setDrafts((current) => {
      const merged = { ...current };
      if (sensitive) { if (state === "corrected") merged[key] = payload.value; }
      else if (key in fresh) merged[key] = fresh[key]; else delete merged[key];
      return merged;
    });
    if (sensitive && state === "corrected") setRevealed((current) => ({ ...current, [key]: payload.value }));
    notify.done("Correction saved");
  }

  async function reveal(key: string, label: string) {
    // Each reveal says why; the audit row keeps the reason (lib/applications/revealReason.ts).
    const reason = await askRevealReason(label);
    if (reason === null) return;
    setRevealing(key); setFieldErrors((current) => ({ ...current, [key]: "" }));
    const response = await fetch("/api/app/inbound/verification/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId, field_key: key, reason }) });
    const body = await response.json().catch(() => null);
    setRevealing(null);
    if (!response.ok) { const message = body?.error ?? "Could not reveal this field"; setFieldErrors((current) => ({ ...current, [key]: message })); notify.block(message); return; }
    setRevealed((current) => ({ ...current, [key]: body.value }));
    setDrafts((current) => (isEmpty(current[key]) ? { ...current, [key]: body.value ?? "" } : current));
  }

  function hide(key: string) {
    setDrafts((current) => (current[key] === revealed[key] ? { ...current, [key]: "" } : current));
    setRevealed((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  async function offerHandoff() {
    if (!handoffTarget) { setHandoffError("Choose a licensed agent before offering the call."); return; }
    setHandoffSaving(true); setHandoffError("");
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "offer", work_item_id: workItemId, target_user_id: handoffTarget }) });
    const body = await response.json().catch(() => null);
    setHandoffSaving(false);
    if (!response.ok) { const message = body?.error ?? "Could not offer this handoff"; setHandoffError(message); notify.block(message); return; }
    notify.arrive("Call passed. The licensed agent sees what you checked before taking over; stay on until they join");
    setHandoffContext(null);
  }

  // "Ask the team" was removed from this screen (owner 2026-10-28); Team › Needs you still nudges.

  async function continueToUnderwriting() {
    setContinuing(true);
    try {
      const response = await fetch("/api/app/applications/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
      const result = await response.json().catch(() => null) as { href?: string; caseId?: string; error?: string } | null;
      if (!response.ok || !result?.href) { setContinueError(result?.error ?? "Could not open the application."); return; }
      // Inside the call page the application opens as its Underwriting step, in place.
      if (onUnderwrite && result.caseId) { onUnderwrite(result.caseId); return; }
      window.location.assign(withFrom(result.href, window.location.pathname));
    } catch {
      setContinueError("Could not open the application — check your connection.");
    } finally {
      setContinuing(false);
    }
  }

  /** Run the existing-customer check again (the lead page's Re-check), and show its answer here. */
  async function recheckSamePerson() {
    if (!panel) return;
    setRechecking(true);
    try {
      const response = await fetch(`/api/app/leads/${encodeURIComponent(panel.workItem.leadId)}/preflight`, { method: "POST" });
      const body = await response.json().catch(() => null) as { result?: SamePersonCheck; error?: string } | null;
      if (!response.ok || !body?.result) { notify.block(body?.error ?? "Could not re-check this lead"); return; }
      setPreflight(body.result);
      setCustomerChecked(false);
      notify.done("Checked again");
    } catch { notify.block("Could not reach Insurvas. Try again."); }
    finally { setRechecking(false); }
  }

  /* A detail page keeps one back link above its title instead of a breadcrumb or a header button. */
  const backLink = (
    <Link href="/app/inbound" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Inbound
    </Link>
  );

  if (loading && !panel) return <PageLoading strip={false} />;
  if (!panel) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {backLink}
        <PageHeader title="Call" />
        {!embedded && <InboundStepBar current={2} />}
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">{error || "Verification is unavailable"}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></span>} />
      </div>
    );
  }

  // What the agent sees: the server's states with the clicks still being saved laid over them.
  const sections = panel.sections.map((section) => ({ ...section, fields: section.fields.map((field) => (field.field_key in optimistic ? { ...field, state: optimistic[field.field_key] } : field)) }));
  const samePerson = preflight === undefined ? panel.preflight : preflight;
  const heldAsCustomer = samePerson?.status === "already_customer" && !customerChecked;
  const allFields = sections.flatMap((section) => section.fields);
  const requiredConfirmed = allFields.filter((field) => field.is_required && ["confirmed", "corrected"].includes(field.state)).length;
  const requiredDone = Object.keys(optimistic).length ? requiredConfirmed >= panel.requiredCount : panel.session.progress_percentage === 100;
  const progressText = `${requiredConfirmed} of ${panel.requiredCount} required details checked`;
  const left = Math.max(0, panel.requiredCount - requiredConfirmed);
  const percent = panel.requiredCount ? Math.round((requiredConfirmed / panel.requiredCount) * 100) : 100;
  const facts = callerFacts(panel);
  const leadName = facts.name;
  const sensitive = new Set(panel.sensitiveKeys ?? []);
  const context = panel.context ?? null;
  // A typed value not yet saved, in any field: the same test each row makes for "Save new value".
  const unsavedKeys = readOnly ? [] : allFields.map((field) => field.field_key).filter((key) => (
    !sensitive.has(key) ? !sameValue(drafts[key], panel.lead.values[key]) : key in revealed ? !sameValue(drafts[key], revealed[key]) : !isEmpty(drafts[key])
  ));
  const dropUnsaved = () => setDrafts((current) => {
    const next = { ...current };
    for (const key of unsavedKeys) next[key] = sensitive.has(key) ? (key in revealed ? revealed[key] : "") : panel.lead.values[key];
    return next;
  });

  // Inbound A, step 2 (owner 2026-10-27). One caller card on the left that stays put while the
  // details scroll; the details in one glass table whose header carries the next steps. The fields,
  // their folding and every write are unchanged (LA-1.11); the outcome is step 3 (?step=finish).
  const onTheCall = callStartedAt ? elapsed(callStartedAt, now) : null;
  return (
    <div className={cn("m-stagger flex w-full min-w-0 flex-col gap-4", embedded && "lg:h-full lg:min-h-0")}>
      <LeaveGuard dirty={unsavedKeys.length > 0} onDiscard={dropUnsaved} what={unsavedKeys.length === 1 ? "a caller detail" : `${unsavedKeys.length} caller details`} />
      {revealReasonDialog}
      {!embedded && backLink}
      {!embedded && (
        <PageHeader
          title={`Call with ${leadName}`}
          actions={<StatusChip tone={onTheCall ? "info" : "neutral"} dot>{onTheCall ? `On the call ${onTheCall}` : "No open call"}</StatusChip>}
        />
      )}
      {!embedded && <InboundStepBar current={2} />}
      {/* Inside the call page (owner 2026-10-28): the screen's full height, no page scroll — the details
          scroll inside their card, and the caller card inside its column. */}
      <div className={cn("flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start", embedded && "lg:min-h-0 lg:flex-1 lg:items-stretch")}>
        <aside aria-label="The caller" className={cn("flex min-w-0 flex-col gap-4 max-lg:order-2 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto", embedded ? "lg:min-h-0" : "lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:max-h-[calc(100dvh-var(--top-bar-h)-32px)] lg:self-start")}>
          <CallerCard workItemId={workItemId} facts={facts} now={now} />
          <SamePersonPrompt
            check={samePerson}
            duplicateFlagged={panel.lead.values?.duplicate_warning === true}
            onRecheck={readOnly ? undefined : () => void recheckSamePerson()}
            busy={rechecking}
            acknowledged={customerChecked}
            onAcknowledge={() => setCustomerChecked(true)}
          />
        </aside>

        <div className={cn("flex min-w-0 flex-1 flex-col gap-4 max-lg:order-1", embedded && "lg:min-h-0")}>
          {continueError && <Callout tone="error" title={continueError} />}
          {context?.claim.at && new Date(panel.session.started_at).getTime() < new Date(context.claim.at).getTime() - 5_000 && (
            <Callout tone="info" title="Picked up from an earlier call: details checked then are kept below." />
          )}
          {readOnly && <Callout tone="info" title="Your agency’s account is paused: details cannot be changed." />}
          {error && <Callout tone="error" title={error} />}

          {canHandoff && handoffContext && (
            <section aria-label="Pass to a licensed agent" className="m-glass flex min-w-0 flex-wrap items-center gap-3 rounded-[16px] border border-[var(--border)] px-4 py-3">
              <label htmlFor="handoff-agent" className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Pass to a licensed agent</label>
              <select id="handoff-agent" className={cn(toolbarControl, "min-w-56 flex-1 sm:flex-none")} value={handoffTarget} disabled={readOnly || handoffSaving} onChange={(event) => setHandoffTarget(event.target.value)}>
                <option value="">Choose an agent…</option>
                {handoffContext.licensedAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.role === "owner" ? "owner" : "agent"})</option>)}
              </select>
              <Button type="button" onClick={() => void offerHandoff()} disabled={readOnly || handoffSaving || !handoffTarget}>{handoffSaving ? "Passing…" : "Pass the call"}</Button>
              <p className="m-0 w-full text-xs leading-[1.5] text-[var(--muted)]">They see what you checked before they take over. Stay on the line until they join.</p>
              {handoffError && <p role="alert" className="m-0 w-full text-sm leading-[1.5] text-[var(--error-ink)]">{handoffError}</p>}
            </section>
          )}
          {canHandoff && handoffError && !handoffContext && <Callout tone="error" title={`Passing the call is unavailable: ${handoffError}`} />}

          <section aria-label="Verification" className={cn("m-glass flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[var(--border)]", embedded && "lg:min-h-0 lg:flex-1")}>
            {/* The header carries the progress and the next steps (owner 2026-10-27: no bar under the table). */}
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-[var(--border)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 flex-wrap items-center gap-3">
                  <h2 className="m-0 text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Verification</h2>
                  <StatusChip dot={false} tone={pillTone(requiredDone ? "success" : "brand")}>{progressText}</StatusChip>
                </span>
                {/* Owner 2026-10-28: Back, Skip (straight to Finish the call), then Continue to Application. */}
                <span className="flex flex-wrap items-center gap-2">
                  {onBack && <Button type="button" size="sm" variant="ghost" onClick={onBack}><ChevronLeft aria-hidden />Back</Button>}
                  {!canHandoff && (embedded ? (
                    <Button type="button" size="sm" variant="outline" onClick={onFinish} title={requiredDone ? "Skip the application and record how the call ended" : `${left} required ${left === 1 ? "detail is" : "details are"} still to check. You can finish first and come back.`}>Skip · finish the call</Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={callHref(workItemId, "finish")} title={requiredDone ? "Skip the application and record how the call ended" : `${left} required ${left === 1 ? "detail is" : "details are"} still to check. You can finish first and come back.`}>Skip · finish the call</Link>
                    </Button>
                  ))}
                  {!readOnly && !canHandoff && (
                    <Button type="button" size="sm" onClick={() => void continueToUnderwriting()} disabled={continuing || heldAsCustomer} title={heldAsCustomer ? "They are already a customer. Check it under Same person? first." : undefined}>
                      {continuing && <Loader2 aria-hidden className="animate-spin" />}Continue to Application<ArrowRight aria-hidden />
                    </Button>
                  )}
                </span>
              </div>
              <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]">
                <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
              <p className="m-0 text-sm leading-[1.5] tracking-[-0.01em] text-[var(--ink)]">
                Read each detail back to the caller. Right? Press <strong className="font-semibold text-[var(--ink)]">It’s right</strong>. Wrong? Type the right one and press <strong className="font-semibold text-[var(--ink)]">Save new value</strong>.
              </p>
            </div>
            <div className={cn("min-w-0", embedded && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto")}>
            {sections.map((section, sectionIndex) => {
              const complete = sectionComplete(section.fields);
              const folded = complete && !reopened[section.section_key];
              const done = section.fields.filter((field) => field.state !== "outstanding").length;
              return (
              <Fragment key={section.section_key}>
                {/* Each template section is a sub-group row inside the one card. A complete one folds (LA-1.11-7). */}
                {complete ? (
                  <button type="button" aria-expanded={!folded} aria-controls={`verify-section-${section.section_key}`} onClick={() => setReopened((current) => ({ ...current, [section.section_key]: !current[section.section_key] }))} className={cn("flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring-color)]", sectionIndex > 0 && "border-t border-solid border-[var(--border)]", label12)}>
                    <span>{section.label}</span>
                    <span className="inline-flex items-center gap-2 normal-case tracking-[-0.01em]">
                      <StatusChip tone="good" dot>Complete · {done} of {section.fields.length}</StatusChip>
                      <ChevronDown aria-hidden className={cn("size-4 transition-transform", !folded && "rotate-180")} />
                    </span>
                  </button>
                ) : (
                  <div className={cn("bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] px-4 py-2", sectionIndex > 0 && "border-t border-[var(--border)]", label12)}>{section.label}</div>
                )}
                {!folded && section.fields.length === 0 && <p className="m-0 border-t border-[var(--border)] px-4 py-3.5 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No fields apply to this section with the answers so far.</p>}
                <div id={`verify-section-${section.section_key}`} hidden={folded}>
                {section.fields.map((field) => {
                  const key = field.field_key;
                  const isSensitive = sensitive.has(key);
                  const isRevealed = key in revealed;
                  const busy = readOnly || saving === key;
                  const look = STATE_LOOK[field.state];
                  const stored = panel.lead.values[key];
                  const placeholder = isSensitive && !isRevealed ? (isEmpty(stored) ? "Not given yet: type it here" : String(stored)) : isEmpty(stored) ? "Not given yet: type it here" : "";
                  const inputId = `verify-${key}`;
                  // An edit that has not been saved yet: the row offers Save new value instead of It's right.
                  const dirty = !isSensitive ? !sameValue(drafts[key], stored) : isRevealed ? !sameValue(drafts[key], revealed[key]) : !isEmpty(drafts[key]);
                  const undoEdit = () => setDrafts((current) => ({ ...current, [key]: isSensitive ? (isRevealed ? revealed[key] : "") : stored }));
                  return (
                    // Enter in the field saves an edit; it never confirms on its own.
                    <form key={key} onSubmit={(event) => { event.preventDefault(); if (dirty && !busy) void update(field, "corrected"); }} className={cn("border-t border-[var(--border)] px-4 py-3 transition-colors", !dirty && look.row)}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-full", dirty ? "border-[1.5px] border-[var(--primary)] text-[var(--accent-ink)]" : look.mark)}>
                          {dirty ? <Pencil className="size-3" /> : field.state === "confirmed" ? <Check className="size-3.5 motion-safe:animate-[m-pulse_.45s_ease-out_1]" /> : field.state === "corrected" ? <Pencil className="size-3" /> : null}
                        </span>
                        <label htmlFor={inputId} className="w-[170px] shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                          {field.label}{field.is_required && <span className="text-[var(--error-ink)]" aria-label="required"> *</span>}
                        </label>
                        <div className="flex min-w-[200px] flex-1 basis-[220px] items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <FieldEditor id={inputId} field={field} value={drafts[key]} placeholder={placeholder} disabled={busy} onChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))} />
                          </div>
                          {isSensitive && !isEmpty(stored) && (
                            isRevealed
                              ? <button type="button" onClick={() => hide(key)} className={b.link}>Hide</button>
                              : <button type="button" onClick={() => void reveal(key, field.label)} disabled={revealing === key} className={b.link} aria-label={`Reveal ${field.label}`}>{revealing === key ? "Revealing…" : "Reveal"}</button>
                          )}
                        </div>
                        <div className="ml-auto flex items-center justify-end gap-2 sm:min-w-[232px]">
                          {dirty ? (
                            <>
                              <Button type="button" size="sm" variant="ghost" onClick={undoEdit} disabled={busy}>Undo edit</Button>
                              <Button type="submit" size="sm" disabled={busy}>{saving === key ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}Save new value</Button>
                            </>
                          ) : field.state === "outstanding" ? (
                            <>
                              <span className="text-xs leading-[1.5] font-semibold text-[var(--body)]">{look.label}</span>
                              <Button type="button" size="sm" variant="outline" className="border-[color-mix(in_srgb,var(--primary)_55%,transparent)] text-[var(--accent-ink)]" onClick={() => void update(field, "confirmed")} disabled={busy}>{saving === key ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}It’s right</Button>
                            </>
                          ) : (
                            <>
                              <StatusChip tone={field.state === "confirmed" ? "good" : "warning"} dot>{look.label}</StatusChip>
                              <button type="button" onClick={() => void update(field, "outstanding")} disabled={busy} className={b.link}>{saving === key ? "Saving…" : "Check again"}</button>
                            </>
                          )}
                        </div>
                      </div>
                      {(field.help_text || fieldErrors[key] || dirty || (isSensitive && isRevealed)) && (
                        <div className="mt-1.5 flex flex-col gap-1 lg:pl-[226px]">
                          {field.help_text && <p className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]">{field.help_text}</p>}
                          {isSensitive && isRevealed && <p className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--body)]">Shown in full for reading back. This reveal was recorded in the audit log.</p>}
                          {dirty && <p className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">{isSensitive ? "New value, not saved yet." : `Was ${displayValue(stored)}. Not saved yet.`} Press Save new value or Enter to keep it.</p>}
                          {fieldErrors[key] && <p role="alert" className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{fieldErrors[key]}</p>}
                        </div>
                      )}
                    </form>
                  );
                })}
                </div>
              </Fragment>
              );
            })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
