"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, ChevronDown, ChevronLeft, Loader2 } from "lucide-react";

import { Callout, KeyValues, Pill, SettingsMeter, Timeline, type PillTone } from "@/components/app/settings/primitives";
import { DispositionWizardDialog } from "@/components/app/disposition-wizard-dialog";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { productLineLabel } from "@/lib/format/productLine";
import { notify } from "@/lib/notify";
import type { TemplateField } from "@/lib/templates/constants";
import type { VerificationState } from "@/lib/verification/progress";
import { cn } from "@/lib/utils";

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
};
type HandoffContext = { canOffer: boolean; licensedAgents: Array<{ id: string; name: string; role: "owner" | "producer" }> };

function isEmpty(value: unknown) { return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0); }
function displayValue(value: unknown) { return Array.isArray(value) ? value.join(", ") : isEmpty(value) ? "nothing" : String(value); }
function sameValue(a: unknown, b: unknown) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || (isEmpty(a) && isEmpty(b)); }
function inputValue(value: unknown, type: TemplateField["type"]) { if (type === "multi_select") return Array.isArray(value) ? value : []; if (type === "boolean") return typeof value === "boolean" ? String(value) : ""; if (type === "currency" && typeof value === "number") return String(value / 100); return value === null || value === undefined ? "" : String(value); }
function clock(value: string | null | undefined) { return value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; }
function elapsed(from: string, now: number) {
  const total = Math.max(0, Math.round((now - new Date(from).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}

/* ── local controls: a text link and a flat 16px editor ─ */

const b = {
  link: "cursor-pointer border-0 bg-transparent p-0 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50",
};
const FLAT = "box-border w-full rounded-[6px] border border-transparent bg-transparent px-2 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] hover:border-[var(--border)] focus:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

const STATE_PILL: Record<VerificationState, { tone: PillTone; label: string }> = {
  confirmed: { tone: "success", label: "Confirmed" },
  corrected: { tone: "warning", label: "Corrected" },
  outstanding: { tone: "error", label: "Outstanding" },
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
          <label key={option} className="inline-flex items-center gap-2 text-[16px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)]">
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

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5", className)}>
      <h2 className="m-0 text-[16px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function VerificationPanel({ workItemId, readOnly, canHandoff }: { workItemId: string; readOnly: boolean; canHandoff: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [revealed, setRevealed] = useState<Record<string, unknown>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [handoffContext, setHandoffContext] = useState<HandoffContext | null>(null);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [handoffSaving, setHandoffSaving] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const [nudgeSaving, setNudgeSaving] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [outcomeOpen, setOutcomeOpen] = useState(false);
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

  async function update(field: PanelField, state: VerificationState) {
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
    notify.done(state === "outstanding" ? "Field marked outstanding" : state === "corrected" ? "Correction saved" : "Field confirmed");
  }

  async function reveal(key: string) {
    setRevealing(key); setFieldErrors((current) => ({ ...current, [key]: "" }));
    const response = await fetch("/api/app/inbound/verification/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId, field_key: key }) });
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
    notify.arrive("Handoff offered; the licensed agent can see verification progress before accepting");
    setHandoffContext(null);
  }

  async function nudgeTeam() {
    setNudgeSaving(true);
    const response = await fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: workItemId, idempotency_key: crypto.randomUUID() }) });
    const body = await response.json().catch(() => null);
    setNudgeSaving(false);
    if (!response.ok) { const message = body?.error ?? "Could not nudge the team."; setError(message); notify.block(message); return; }
    notify.done(body.nudge?.alreadySent ? "That nudge was already sent" : "Team nudged");
  }

  const labels = useMemo(() => new Map((panel?.sections ?? []).flatMap((section) => section.fields.map((field) => [field.field_key, field.label] as const))), [panel?.sections]);

  async function continueToUnderwriting() {
    setContinuing(true);
    try {
      const response = await fetch("/api/app/applications/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
      const result = await response.json().catch(() => null) as { href?: string; error?: string } | null;
      if (!response.ok || !result?.href) { setContinueError(result?.error ?? "Could not open the application."); return; }
      window.location.assign(result.href);
    } catch {
      setContinueError("Could not open the application — check your connection.");
    } finally {
      setContinuing(false);
    }
  }

  const actions = (
    <>
      {!readOnly && panel && (
        <Button type="button" variant="outline" onClick={() => void nudgeTeam()} disabled={nudgeSaving}>
          {nudgeSaving ? <Loader2 aria-hidden className="animate-spin" /> : <Bell aria-hidden />}Nudge team
        </Button>
      )}
      {/* Opens the call-outcome dialog over this panel; "Back to verification" in it just closes it.
          /app/inbound/[id]/disposition stays for deep links. */}
      {/* LA-3: the same application workspace the dialer opens. Assistants verify; the licensed agent underwrites. */}
      {!readOnly && panel && !canHandoff && (
        <Button type="button" variant="outline" onClick={() => void continueToUnderwriting()} disabled={continuing}>
          {continuing && <Loader2 aria-hidden className="animate-spin" />}Continue to underwriting
        </Button>
      )}
      <Button type="button" onClick={() => setOutcomeOpen(true)}>Record call outcome</Button>
      <DispositionWizardDialog workItemId={workItemId} open={outcomeOpen} onOpenChange={setOutcomeOpen} readOnly={readOnly} onBackToVerification={() => setOutcomeOpen(false)} />
    </>
  );
  /* A detail page keeps one back link above its title instead of a breadcrumb or a header button. */
  const backLink = (
    <Link href="/app/inbound" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Inbound transfers
    </Link>
  );

  if (loading && !panel) return <PageLoading strip={false} />;
  if (!panel) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {backLink}
        <PageHeader title="Verification" />
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">{error || "Verification is unavailable"}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></span>} />
      </div>
    );
  }

  const requiredDone = panel.session.progress_percentage === 100;
  const allFields = panel.sections.flatMap((section) => section.fields);
  const requiredConfirmed = allFields.filter((field) => field.is_required && ["confirmed", "corrected"].includes(field.state)).length;
  const progressText = `${requiredConfirmed} of ${panel.requiredCount} required fields confirmed`;
  const leadName = String(panel.lead.values.full_name ?? panel.lead.values.name ?? ([panel.lead.values.first_name, panel.lead.values.last_name].filter(Boolean).join(" ") || "Customer"));
  const leadState = String(panel.lead.carrier_state ?? panel.lead.values.state ?? panel.lead.values.address_state ?? "State not provided");
  const source = String(panel.lead.values.source ?? panel.lead.values.lead_source ?? "Partner transfer");
  const sensitive = new Set(panel.sensitiveKeys ?? []);
  const context = panel.context ?? null;
  const history = context?.history ?? [];
  const historyShown = showAllHistory ? history : history.slice(0, 8);
  const historyTitle = (entry: HistoryEntry) => {
    if (entry.kind === "claimed") return "Claimed";
    const label = (entry.fieldKey && labels.get(entry.fieldKey)) || "A field";
    return entry.kind === "corrected" ? `${label} corrected` : entry.kind === "outstanding" ? `${label} marked outstanding` : `${label} confirmed`;
  };

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {backLink}
      <PageHeader title={`Verification — ${leadName}`} actions={actions} />
      {continueError && <Callout tone="error" title={continueError} />}

      <section aria-label="Call" className="grid min-w-0 gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4 sm:grid-cols-3 lg:grid-cols-5">
        {[["Customer", leadName], ["State", leadState], ["Product", panel.template.product_name || productLineLabel(panel.workItem.productLine)], ["Lead source", source], ["Session status", requiredDone ? "Complete" : "In progress"]].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className={label12}>{label}</div>
            <div className="mt-1 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{value}</div>
          </div>
        ))}
      </section>

      {context?.claim.at && new Date(panel.session.started_at).getTime() < new Date(context.claim.at).getTime() - 5_000 && (
        <Callout tone="info" title="Resumed from an earlier call: fields confirmed or corrected then are kept below." />
      )}
      {readOnly && <Callout tone="info" title="Your account is read-only: field changes are disabled." />}
      {error && <Callout tone="error" title={error} />}

      {canHandoff && handoffContext && (
        <section aria-label="Hand off to a licensed agent" className="flex min-w-0 flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <label htmlFor="handoff-agent" className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Hand off to a licensed agent</label>
          <select id="handoff-agent" className={cn(toolbarControl, "min-w-56 flex-1 sm:flex-none")} value={handoffTarget} disabled={readOnly || handoffSaving} onChange={(event) => setHandoffTarget(event.target.value)}>
            <option value="">Choose an agent…</option>
            {handoffContext.licensedAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>)}
          </select>
          <Button type="button" onClick={() => void offerHandoff()} disabled={readOnly || handoffSaving || !handoffTarget}>{handoffSaving ? "Offering…" : "Offer handoff"}</Button>
          {handoffError && <p role="alert" className="m-0 w-full text-[14px] leading-[1.5] text-[var(--error-ink)]">{handoffError}</p>}
        </section>
      )}
      {canHandoff && handoffError && !handoffContext && <Callout tone="error" title={`Handoff is unavailable: ${handoffError}`} />}

      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section aria-label="Application fields" className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
              <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Application fields</span>
              <Pill tone={requiredDone ? "success" : "brand"}>{progressText}</Pill>
            </div>
            {panel.sections.map((section, sectionIndex) => {
              const complete = sectionComplete(section.fields);
              const folded = complete && !reopened[section.section_key];
              const done = section.fields.filter((field) => field.state !== "outstanding").length;
              return (
              <Fragment key={section.section_key}>
                {/* Each template section is a sub-group row inside the one card. A complete one folds (LA-1.11-7). */}
                {complete ? (
                  <button type="button" aria-expanded={!folded} aria-controls={`verify-section-${section.section_key}`} onClick={() => setReopened((current) => ({ ...current, [section.section_key]: !current[section.section_key] }))} className={cn("flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-[var(--canvas)] px-4 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring-color)]", sectionIndex > 0 && "border-t border-solid border-[var(--border)]", label12)}>
                    <span>{section.label}</span>
                    <span className="inline-flex items-center gap-2 normal-case tracking-[-0.01em]">
                      <Pill tone="success" dot>Complete · {done} of {section.fields.length}</Pill>
                      <ChevronDown aria-hidden className={cn("size-4 transition-transform", !folded && "rotate-180")} />
                    </span>
                  </button>
                ) : (
                  <div className={cn("bg-[var(--canvas)] px-4 py-2", sectionIndex > 0 && "border-t border-[var(--border)]", label12)}>{section.label}</div>
                )}
                {!folded && section.fields.length === 0 && <p className="m-0 border-t border-[var(--border)] px-4 py-3.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No fields apply to this section with the answers so far.</p>}
                <div id={`verify-section-${section.section_key}`} hidden={folded}>
                {section.fields.map((field) => {
                  const key = field.field_key;
                  const isSensitive = sensitive.has(key);
                  const isRevealed = key in revealed;
                  const busy = readOnly || saving === key;
                  const pill = STATE_PILL[field.state];
                  const stored = panel.lead.values[key];
                  const placeholder = isSensitive && !isRevealed ? (isEmpty(stored) ? "not yet given" : String(stored)) : isEmpty(stored) ? "not yet given" : "";
                  const inputId = `verify-${key}`;
                  // An edit that has not been saved yet: Confirm would confirm the stored value, so say so.
                  const dirty = !isSensitive ? !sameValue(drafts[key], stored) : isRevealed ? !sameValue(drafts[key], revealed[key]) : !isEmpty(drafts[key]);
                  return (
                    <div key={key} className="border-t border-[var(--border)] px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-4">
                        <label htmlFor={inputId} className="w-[190px] shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">
                          {field.label}{field.is_required && <span className="text-[var(--error-ink)]" aria-label="required"> *</span>}
                        </label>
                        <div className="flex min-w-[200px] flex-1 basis-[220px] items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <FieldEditor id={inputId} field={field} value={drafts[key]} placeholder={placeholder} disabled={busy} onChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))} />
                          </div>
                          {isSensitive && !isEmpty(stored) && (
                            isRevealed
                              ? <button type="button" onClick={() => hide(key)} className={b.link}>Hide</button>
                              : <button type="button" onClick={() => void reveal(key)} disabled={revealing === key} className={b.link} aria-label={`Reveal ${field.label}`}>{revealing === key ? "Revealing…" : "Reveal"}</button>
                          )}
                        </div>
                        <div className="ml-auto flex items-center gap-4">
                          <Pill tone={pill.tone} dot>{pill.label}</Pill>
                          <span className="flex gap-2">
                            {field.state === "outstanding" ? (
                              <>
                                <Button type="button" size="sm" variant="outline" onClick={() => void update(field, "confirmed")} disabled={busy}>{saving === key ? <Loader2 aria-hidden className="animate-spin" /> : null}Confirm</Button>
                                <Button type="button" size="sm" variant={dirty ? "default" : "outline"} onClick={() => void update(field, "corrected")} disabled={busy}>Save correction</Button>
                              </>
                            ) : (
                              <>
                                <Button type="button" size="sm" variant={dirty ? "default" : "outline"} onClick={() => void update(field, "corrected")} disabled={busy}>{saving === key ? <Loader2 aria-hidden className="animate-spin" /> : null}Save correction</Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => void update(field, "outstanding")} disabled={busy}>Mark outstanding</Button>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                      {(field.help_text || fieldErrors[key] || dirty || (isSensitive && isRevealed)) && (
                        <div className="mt-1.5 flex flex-col gap-1 lg:pl-[206px]">
                          {field.help_text && <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{field.help_text}</p>}
                          {isSensitive && isRevealed && <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Shown in full for reading back. This reveal was recorded in the audit log.</p>}
                          {dirty && <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">{isSensitive ? "Unsaved correction." : `Changed from ${displayValue(stored)}, not saved yet.`} Save correction to keep it.</p>}
                          {fieldErrors[key] && <p role="alert" className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">{fieldErrors[key]}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </Fragment>
              );
            })}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:w-[360px] lg:shrink-0">
          <Card title="Verification progress">
            <SettingsMeter value={panel.session.progress_percentage} max={100} tone={requiredDone ? "success" : "primary"} caption={progressText} ariaLabel={progressText} />
            <div className="mt-4">
              <KeyValues items={[
                { label: "Claimed by", value: context?.claim.byName ? `${context.claim.byName}, ${clock(context.claim.at)}` : "—" },
                { label: "Partner", value: context?.partnerName ?? "—" },
                { label: "Since claim", value: callStartedAt ? elapsed(callStartedAt, now) : "No open call record" },
                { label: "Product", value: panel.template.product_name || productLineLabel(panel.workItem.productLine) },
              ]} />
            </div>
          </Card>

          <Card title="Change history">
            {history.length === 0 ? (
              <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{context ? "No changes recorded yet." : "The change history could not be loaded."}</p>
            ) : (
              <>
                <Timeline items={historyShown.map((entry) => ({ title: historyTitle(entry), sub: `${entry.actorName} · ${clock(entry.at)}`, tone: entry.kind === "corrected" ? "warning" : entry.kind === "confirmed" ? "success" : entry.kind === "outstanding" ? "error" : "muted" }))} />
                {history.length > historyShown.length && <button type="button" onClick={() => setShowAllHistory(true)} className={cn(b.link, "mt-3")}>Show all {history.length}</button>}
              </>
            )}
          </Card>

          <Card title="Call context">
            <KeyValues items={[
              { label: "Lead ID", value: panel.workItem.leadId },
              { label: "Product", value: productLineLabel(panel.workItem.productLine) },
              { label: "Lead source", value: source },
              { label: "State", value: leadState },
              { label: "Template", value: `v${panel.template.definition_version ?? "default"}` },
              { label: "Started", value: new Date(panel.session.started_at).toLocaleString() },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
