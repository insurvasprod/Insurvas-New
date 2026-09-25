"use client";

/**
 * Settings → Dispositions, drawn from p-set-dispositions.
 *
 * The outcome table is a draft: an Edit applies to this screen only, and the header's Save writes
 * every changed outcome. The wizard's question graph keeps saving each edit as it is made, inside
 * its own editor, because a half-saved graph is what the wizard would walk.
 *
 * Nothing here names a disposition key. What an outcome does next (cadence, retry, rest, close,
 * suppress, book a callback) is the outcome's own setting, which the dialer SQL reads
 * (20260924240200); the choices an outcome may make come from lib/dispositions/nextAction.ts, so
 * this screen cannot grow a second vocabulary (lib/dispositions/oneVocabulary.test.mjs).
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SearchBox,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  TableToolbar,
  Timeline,
  ToggleRow,
  btn,
  control,
  st,
} from "@/components/app/settings/primitives";
import type {
  DispositionCloseStatus,
  DispositionFlow,
  DispositionNode,
  DispositionNodeType,
  DispositionOption,
  DispositionSettingsRow,
} from "@/lib/dispositions/types";
import { DISPOSITION_KEY_PATTERN } from "@/lib/dispositions/types";
import {
  allowedNextActions,
  endsDialing,
  needsMinutes,
  nextActionLabel,
  NEXT_ACTION_OPTION_LABELS,
  splitMinutes,
  toMinutes,
  type DurationUnit,
  type NextActionKind,
  type NextActionSetting,
} from "@/lib/dispositions/nextAction";

type Stage = { id: string; pipeline_id: string; name: string; stage_type: string; is_archived: boolean; pipeline_name: string };
type Config = {
  dispositions: DispositionSettingsRow[];
  flows: DispositionFlow[];
  stages: Stage[];
  ends_call_available?: boolean;
  /** False until 20260924240200: only close / cadence can be chosen, through Ends call. */
  next_action_available?: boolean;
  pipelines?: { id: string; name: string }[];
};
type Edit = Partial<Pick<DispositionSettingsRow, "label" | "counts_as_work_completed" | "closes_as" | "is_active" | "ends_call" | "next">> & {
  /** The stage the outcome moves a lead to, when changed in this draft. */
  stage_id?: string;
};
type NewNode = { node_key: string; label: string; prompt: string; node_type: DispositionNodeType; note_template: string };
type NewOption = { node_id: string; option_key: string; label: string; disposition_key: string; note_template: string };

type StatusFilter = "active" | "archived" | "all";
type YesNoFilter = "any" | "yes" | "no";
type ClosesFilter = "any" | "won" | "lost" | "none";
type Filters = { status: StatusFilter; work: YesNoFilter; closes: ClosesFilter };
const DEFAULT_FILTERS: Filters = { status: "active", work: "any", closes: "any" };

const NODE_TYPE_LABELS: Record<DispositionNodeType, string> = { choice: "Choice", multi_select: "Multiple choice", free_text: "Free text" };

class SaveError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function send(payload: unknown, method: "PATCH" | "POST" = "PATCH") {
  const response = await fetch("/api/app/dispositions/config", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new SaveError(body?.error ?? "Could not save disposition settings", response.status);
  return body;
}

const blankNode: NewNode = { node_key: "", label: "", prompt: "", node_type: "choice", note_template: "" };
const blankOption: NewOption = { node_id: "", option_key: "", label: "", disposition_key: "", note_template: "" };

function slug(label: string) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);
  return /^[a-z]/.test(base) ? base : base ? `outcome_${base}` : "";
}

/** Won / Lost is the funnel's word, and it comes from the stage the outcome moves the lead to. */
function closesAs(row: DispositionSettingsRow): "won" | "lost" | null {
  const type = row.mapped_stage?.stage_type;
  return type === "won" || type === "lost" ? type : null;
}

function nextActionText(row: DispositionSettingsRow) {
  const main = nextActionLabel(row.next);
  const stage = row.mapped_stage;
  if (!stage) return { main, sub: row.is_active ? "No stage — refused on save" : null };
  // The dialer never relocates a lead that is going back into its queue; the wizard moves any mapped outcome.
  const back = row.next?.kind === "cadence" || row.next?.kind === "retry";
  const sub = back ? `Moves to ${stage.name} from the wizard only` : `Moves to ${stage.name}`;
  return { main, sub };
}

/** "in Outbound or Inbound" — the pipelines a refusal names. */
function pipelineNames(names: string[]) {
  if (names.length === 0) return "";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function noStageMessage(label: string, pipelines: string[]) {
  const where = pipelineNames(pipelines);
  return `“${label || "This outcome"}” has no stage. Choose the stage it moves the lead to${where ? ` — in ${where}` : ""} — before saving.`;
}

/** The stage picker: every live stage, grouped by pipeline. */
function StageSelect({ id, value, stages, onChange }: { id: string; value: string; stages: Stage[]; onChange: (value: string) => void }) {
  const live = stages.filter((stage) => !stage.is_archived);
  const pipelines = [...new Map(live.map((stage) => [stage.pipeline_id, stage.pipeline_name])).entries()];
  return (
    <select id={id} className={control} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose a stage</option>
      {pipelines.map(([pipelineId, name]) => (
        <optgroup key={pipelineId} label={name}>
          {live.filter((stage) => stage.pipeline_id === pipelineId).map((stage) => (
            <option key={stage.id} value={stage.id}>{stage.name}{stage.stage_type === "open" ? "" : " · closes"}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * The next action, with its delay. Ends call narrows the choice: an outcome that ends dialing closes
 * or rests the lead; one that does not goes back on the cadence or retries after a set time.
 */
function NextActionFields({
  idPrefix,
  dispositionKey,
  endsCall,
  value,
  available,
  onChange,
}: {
  idPrefix: string;
  dispositionKey: string;
  endsCall: boolean;
  value: NextActionSetting;
  available: boolean;
  onChange: (next: NextActionSetting) => void;
}) {
  const allowed = allowedNextActions(dispositionKey);
  const choices = allowed.length === 1 ? allowed : allowed.filter((kind) => endsDialing(kind) === endsCall && (available || !needsMinutes(kind)));
  const split = splitMinutes(value.minutes ?? (value.kind === "rest" ? 90 * 1440 : 20));
  const [unit, setUnit] = useState<DurationUnit>(split.unit);
  const [amount, setAmount] = useState(String(split.value));
  function pick(kind: NextActionKind) {
    if (!needsMinutes(kind)) return onChange({ kind, minutes: null });
    const defaults = kind === "rest" ? { value: 90, unit: "days" as const } : { value: 20, unit: "minutes" as const };
    setAmount(String(defaults.value));
    setUnit(defaults.unit);
    onChange({ kind, minutes: toMinutes(defaults.value, defaults.unit) });
  }
  function setDuration(nextAmount: string, nextUnit: DurationUnit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const n = Number(nextAmount);
    onChange({ kind: value.kind, minutes: Number.isFinite(n) && n > 0 ? toMinutes(n, nextUnit) : null });
  }
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Next action"
        htmlFor={`${idPrefix}-next`}
        hint={
          allowed.length === 1
            ? "Fixed: the dialer handles this outcome in its own step."
            : available
              ? "What the dialer does after this outcome is recorded."
              : "Retry delays and rests need a database update that has not been applied yet."
        }
      >
        <select id={`${idPrefix}-next`} className={control} value={value.kind} disabled={choices.length <= 1} onChange={(event) => pick(event.target.value as NextActionKind)}>
          {choices.map((kind) => <option key={kind} value={kind}>{NEXT_ACTION_OPTION_LABELS[kind]}</option>)}
        </select>
      </Field>
      {needsMinutes(value.kind) && (
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label={value.kind === "rest" ? "Rest for" : "Retry after"} htmlFor={`${idPrefix}-amount`} hint={value.kind === "retry" ? "The cadence's attempt limit still applies." : "Then the lead is served again."}>
            <input id={`${idPrefix}-amount`} className={control} type="number" min={1} step={1} value={amount} onChange={(event) => setDuration(event.target.value, unit)} />
          </Field>
          <Field label="Unit" htmlFor={`${idPrefix}-unit`}>
            <select id={`${idPrefix}-unit`} className={control} value={unit} onChange={(event) => setDuration(amount, event.target.value as DurationUnit)}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

/** A next action consistent with the Ends call flag: the first allowed choice when it is not. */
function coerceNext(dispositionKey: string, endsCall: boolean, current: NextActionSetting | null): NextActionSetting {
  const allowed = allowedNextActions(dispositionKey);
  if (allowed.length === 1) return { kind: allowed[0], minutes: null };
  if (current && allowed.includes(current.kind) && endsDialing(current.kind) === endsCall) return current;
  return { kind: endsCall ? "close" : "cadence", minutes: null };
}

function minutesProblem(next: NextActionSetting): string {
  if (!needsMinutes(next.kind)) return "";
  if (!next.minutes || next.minutes < 1 || next.minutes > 525_600 || !Number.isInteger(next.minutes)) return "Choose a whole number of minutes, hours or days, up to 365 days.";
  return "";
}

function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value == null) return <span className="text-[var(--muted)]">—</span>;
  return value ? <Pill tone="success">Yes</Pill> : <Pill tone="neutral">No</Pill>;
}

function SettingsDialog({ open, onOpenChange, title, description, wide, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] text-[var(--body)]", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="text-[18px] text-[var(--ink)]">{title}</DialogTitle>
          {description && <DialogDescription className="text-[14px] leading-[1.5] text-[var(--muted)]">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/* ── filters ───────────────────────────────────────────────────────────── */

function FilterIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16M7 12h10M10 19h4" />
    </svg>
  );
}

function FiltersButton({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const active = (filters.status !== "all" ? 1 : 0) + (filters.work !== "any" ? 1 : 0) + (filters.closes !== "any" ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const select = "box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] text-[var(--ink)]";
  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)]"
      >
        <FilterIcon />
        Filters
        {active > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] font-semibold text-[var(--ink)]">{active}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Filter outcomes" className="absolute top-12 left-0 z-20 flex w-[260px] flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-rest)]">
          <Field label="Status" htmlFor="outcome-filter-status">
            <select id="outcome-filter-status" className={cn(select, "mt-1.5")} value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value as StatusFilter })}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">Active and archived</option>
            </select>
          </Field>
          <Field label="Counts as work" htmlFor="outcome-filter-work">
            <select id="outcome-filter-work" className={cn(select, "mt-1.5")} value={filters.work} onChange={(event) => onChange({ ...filters, work: event.target.value as YesNoFilter })}>
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Field label="Closes as" htmlFor="outcome-filter-closes">
            <select id="outcome-filter-closes" className={cn(select, "mt-1.5")} value={filters.closes} onChange={(event) => onChange({ ...filters, closes: event.target.value as ClosesFilter })}>
              <option value="any">Any</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="none">Not closed by a stage</option>
            </select>
          </Field>
          <button type="button" className={btn("secondary", "self-start")} onClick={() => onChange({ status: "all", work: "any", closes: "any" })} disabled={active === 0}>
            Clear filters
          </button>
        </div>
      )}
    </span>
  );
}

/* ── outcome dialogs ───────────────────────────────────────────────────── */

function OutcomeEditor({
  row,
  saved,
  stages,
  pipelines,
  endsCallAvailable,
  nextActionAvailable,
  onApply,
  onClose,
}: {
  row: DispositionSettingsRow;
  saved: DispositionSettingsRow;
  stages: Stage[];
  pipelines: string[];
  endsCallAvailable: boolean;
  nextActionAvailable: boolean;
  onApply: (edit: Edit) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [work, setWork] = useState(row.counts_as_work_completed);
  const [endsCall, setEndsCall] = useState<boolean | null>(row.ends_call ?? null);
  const [next, setNext] = useState<NextActionSetting>(coerceNext(row.disposition_key, row.ends_call ?? false, row.next));
  const [stageId, setStageId] = useState(row.mapped_stage?.id ?? "");
  const [closes, setCloses] = useState<DispositionCloseStatus>(row.closes_as);
  const [active, setActive] = useState(row.is_active);
  const [error, setError] = useState("");
  const knownNext = endsCallAvailable && endsCall !== null;
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!label.trim() || label.trim().length > 120) { setError("The label must be between 1 and 120 characters."); return; }
    // Every outcome maps to a stage: refused here, with the pipelines named, as the server refuses it.
    if (active && !stageId) { setError(noStageMessage(label.trim(), pipelines)); return; }
    const minutes = knownNext ? minutesProblem(next) : "";
    if (minutes) { setError(minutes); return; }
    const edit: Edit = {};
    if (label.trim() !== saved.label) edit.label = label.trim();
    if (work !== saved.counts_as_work_completed) edit.counts_as_work_completed = work;
    if (closes !== saved.closes_as) edit.closes_as = closes;
    if (active !== saved.is_active) edit.is_active = active;
    if (endsCall !== null && endsCall !== (saved.ends_call ?? null)) edit.ends_call = endsCall;
    if (knownNext && (next.kind !== saved.next?.kind || next.minutes !== (saved.next?.minutes ?? null))) edit.next = next;
    if (stageId && stageId !== (saved.mapped_stage?.id ?? "")) edit.stage_id = stageId;
    onApply(edit);
  }
  const stage = stages.find((item) => item.id === stageId) ?? null;
  const stageCloses = stage && stage.stage_type !== "open" ? (stage.stage_type === "won" ? "Won" : "Lost") : null;
  return (
    <form className="flex flex-col gap-4" onSubmit={apply}>
      <Field label="Label" htmlFor="outcome-edit-label" required hint={<>Key <code className={st.code}>{row.disposition_key}</code> — stored on every call, so it never changes.</>}>
        <input id="outcome-edit-label" className={control} maxLength={120} value={label} onChange={(event) => { setLabel(event.target.value); setError(""); }} />
      </Field>
      <ToggleRow id="outcome-edit-work" title="Counts as work" help="Counted as worked on the activity scorecard when an agent records it." checked={work} onChange={setWork} />
      <ToggleRow
        id="outcome-edit-ends"
        title="Ends call"
        help={
          !endsCallAvailable
            ? "Needs a database update that has not been applied yet."
            : row.ends_call_fixed
              ? "Always on: the dialer handles this outcome in its own step."
              : "Recorded on the dialer, the lead's calling ends here: it is closed or rested instead of going back on the retry cadence."
        }
        checked={endsCall === true}
        disabled={!endsCallAvailable || row.ends_call_fixed}
        onChange={(value) => { setEndsCall(value); setNext((current) => coerceNext(row.disposition_key, value, current)); }}
      />
      {knownNext && (
        <NextActionFields idPrefix="outcome-edit" dispositionKey={row.disposition_key} endsCall={endsCall === true} value={next} available={nextActionAvailable} onChange={(value) => { setNext(value); setError(""); }} />
      )}
      <Field label="Moves to" htmlFor="outcome-edit-stage" required={active} hint={stage ? `${stage.pipeline_name}${stageCloses ? `, which closes as ${stageCloses}` : ""}. Recording the outcome moves the lead there.` : "Every outcome lands somewhere. An archived outcome may be left without one."}>
        <StageSelect id="outcome-edit-stage" value={stageId} stages={stages} onChange={(value) => { setStageId(value); setError(""); }} />
      </Field>
      <Field label="The work item closes as" htmlFor="outcome-edit-closes" hint="Completed or dropped on the transfer itself. Won or lost comes from the stage above.">
        <select id="outcome-edit-closes" className={control} value={closes} onChange={(event) => setCloses(event.target.value as DispositionCloseStatus)}>
          <option value="completed">Completed</option>
          <option value="dropped">Dropped</option>
        </select>
      </Field>
      <ToggleRow id="outcome-edit-active" title="Active" help="Archived outcomes leave the wizard. Past calls keep their label; nothing is deleted." checked={active} onChange={(value) => { setActive(value); setError(""); }} />
      {error && <Callout tone="error" title="This outcome cannot be applied yet">{error}</Callout>}
      <div className="flex justify-end gap-2.5">
        <button type="button" className={btn("ghost")} onClick={onClose}>Cancel</button>
        <button type="submit" className={btn("primary")}>Apply</button>
      </div>
      <p className="m-0 text-[12px] leading-[1.5] text-[var(--muted)]">Applied changes are held until you choose Save changes at the top of the section.</p>
    </form>
  );
}

function AddOutcome({ stages, pipelines, endsCallAvailable, nextActionAvailable, onCreated, onClose }: { stages: Stage[]; pipelines: string[]; endsCallAvailable: boolean; nextActionAvailable: boolean; onCreated: () => Promise<void>; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [work, setWork] = useState(true);
  const [endsCall, setEndsCall] = useState(false);
  const [next, setNext] = useState<NextActionSetting>({ kind: "cadence", minutes: null });
  const [stageId, setStageId] = useState("");
  const [closes, setCloses] = useState<DispositionCloseStatus>("completed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dispositionKey = keyTouched ? keyValue : slug(label);
  const effectiveNext = coerceNext(dispositionKey, endsCall, next);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!DISPOSITION_KEY_PATTERN.test(dispositionKey)) { setError("The key must start with a letter and use lowercase letters, numbers and underscores."); return; }
    if (!stageId) { setError(noStageMessage(label.trim(), pipelines)); return; }
    const minutes = endsCallAvailable ? minutesProblem(effectiveNext) : "";
    if (minutes) { setError(minutes); return; }
    setSaving(true);
    setError("");
    try {
      await send({
        kind: "disposition",
        disposition_key: dispositionKey,
        label: label.trim(),
        counts_as_work_completed: work,
        closes_as: closes,
        stage_id: stageId,
        ...(endsCallAvailable ? { ends_call: endsCall } : {}),
        ...(endsCallAvailable && nextActionAvailable ? { next_action: effectiveNext.kind, next_action_minutes: effectiveNext.minutes } : {}),
      }, "POST");
      notify.done("Outcome added");
      await onCreated();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the outcome");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <Field label="Label" htmlFor="outcome-new-label" required>
        <input id="outcome-new-label" className={control} required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field label="Key" htmlFor="outcome-new-key" required hint="Stored on every call that records it, so it cannot be changed later.">
        <input id="outcome-new-key" className={cn(control, "font-mono")} required maxLength={80} value={dispositionKey} onChange={(event) => { setKeyTouched(true); setKeyValue(event.target.value); }} />
      </Field>
      <ToggleRow id="outcome-new-work" title="Counts as work" help="Counted as worked on the activity scorecard when an agent records it." checked={work} onChange={setWork} />
      <ToggleRow id="outcome-new-ends" title="Ends call" help={endsCallAvailable ? "The wizard offers new outcomes at once. The dialer's own buttons are a fixed set today, so this takes effect there only for outcomes it can record." : "Needs a database update that has not been applied yet."} checked={endsCall} disabled={!endsCallAvailable} onChange={(value) => { setEndsCall(value); setNext((current) => coerceNext(dispositionKey, value, current)); }} />
      {endsCallAvailable && (
        <NextActionFields idPrefix="outcome-new" dispositionKey={dispositionKey} endsCall={endsCall} value={effectiveNext} available={nextActionAvailable} onChange={setNext} />
      )}
      <Field label="Moves to" htmlFor="outcome-new-stage" required hint="Every outcome lands somewhere: recording it moves the lead to this stage.">
        <StageSelect id="outcome-new-stage" value={stageId} stages={stages} onChange={(value) => { setStageId(value); setError(""); }} />
      </Field>
      <Field label="The work item closes as" htmlFor="outcome-new-closes">
        <select id="outcome-new-closes" className={control} value={closes} onChange={(event) => setCloses(event.target.value as DispositionCloseStatus)}>
          <option value="completed">Completed</option>
          <option value="dropped">Dropped</option>
        </select>
      </Field>
      {error && <Callout tone="error" title="The outcome was not added">{error}</Callout>}
      <div className="flex justify-end gap-2.5">
        <button type="button" className={btn("ghost")} onClick={onClose}>Cancel</button>
        <button type="submit" className={btn("primary")} disabled={saving || !label.trim()}>{saving ? "Adding…" : "Add outcome"}</button>
      </div>
    </form>
  );
}

/* ── wizard graph editor (saves each edit, as it always has) ───────────── */

const small = "box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] text-[var(--ink)] mt-1.5";

function OutcomeKeySelect({ id, value, outcomes, onChange }: { id: string; value: string; outcomes: DispositionSettingsRow[]; onChange: (value: string) => void }) {
  const known = outcomes.some((item) => item.disposition_key === value);
  return (
    <select id={id} className={small} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">None</option>
      {!known && value && <option value={value}>{value} (not an outcome)</option>}
      {outcomes.map((item) => <option key={item.id} value={item.disposition_key}>{item.label}{item.is_active ? "" : " (archived)"}</option>)}
    </select>
  );
}

function FlowEditor({ config, flowId, onFlowChange, reload }: { config: Config; flowId: string; onFlowChange: (id: string) => void; reload: () => Promise<void> }) {
  const [newNode, setNewNode] = useState<NewNode>(blankNode);
  const [newOption, setNewOption] = useState<NewOption>(blankOption);
  const flow = config.flows.find((item) => item.id === flowId) ?? null;
  const nodes = flow?.nodes ?? [];

  async function saveAndReload(payload: unknown, done: string, method: "PATCH" | "POST" = "PATCH") {
    try { await send(payload, method); await reload(); notify.done(done); return true; }
    catch (error) { notify.fail(error instanceof Error ? error.message : "Could not save"); return false; }
  }
  function updateNode(node: DispositionNode, patch: Partial<DispositionNode>) {
    void saveAndReload({ kind: "node", id: node.id, label: patch.label ?? node.label, prompt: patch.prompt ?? node.prompt, node_type: patch.node_type ?? node.node_type, note_template: patch.note_template !== undefined ? patch.note_template : node.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : node.next_node_id }, "Question saved");
  }
  function updateOption(option: DispositionOption, patch: { label?: string; disposition_key?: string | null; note_template?: string | null; next_node_id?: string | null }) {
    void saveAndReload({ kind: "option", id: option.id, label: patch.label ?? option.label, disposition_key: patch.disposition_key !== undefined ? patch.disposition_key : option.disposition_key, note_template: patch.note_template !== undefined ? patch.note_template : option.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : option.next_node_id }, "Answer saved");
  }
  async function createNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flowId) return;
    if (await saveAndReload({ kind: "node", flow_id: flowId, ...newNode, note_template: newNode.note_template || null }, "Question added", "POST")) setNewNode(blankNode);
  }
  async function createOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOption.node_id) return;
    if (await saveAndReload({ kind: "option", ...newOption, note_template: newOption.note_template || null, disposition_key: newOption.disposition_key || null }, "Answer added", "POST")) setNewOption(blankOption);
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label="Wizard" htmlFor="flow-editor-flow" hint="Each pipeline stage has its own. Edits here save as you make them.">
        <select id="flow-editor-flow" className={control} value={flowId} onChange={(event) => { onFlowChange(event.target.value); setNewOption(blankOption); }}>
          {config.flows.map((item) => <option key={item.id} value={item.id}>{item.stage_name} · {item.name}</option>)}
        </select>
      </Field>

      {nodes.map((node) => (
        <section key={node.id} className="rounded-[12px] border border-[var(--border)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Question" htmlFor={`node-label-${node.id}`}>
              <input id={`node-label-${node.id}`} className={small} defaultValue={node.label} maxLength={160} onBlur={(event) => { if (event.target.value !== node.label) updateNode(node, { label: event.target.value }); }} />
            </Field>
            <Field label="Prompt" htmlFor={`node-prompt-${node.id}`}>
              <input id={`node-prompt-${node.id}`} className={small} defaultValue={node.prompt} maxLength={2000} onBlur={(event) => { if (event.target.value !== node.prompt) updateNode(node, { prompt: event.target.value }); }} />
            </Field>
            <Field label="Question type" htmlFor={`node-type-${node.id}`}>
              <select id={`node-type-${node.id}`} className={small} value={node.node_type} onChange={(event) => updateNode(node, { node_type: event.target.value as DispositionNodeType })}>
                {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Next question" htmlFor={`node-next-${node.id}`} hint="Used by free-text and multiple-choice questions.">
              <select id={`node-next-${node.id}`} className={small} value={node.next_node_id ?? ""} onChange={(event) => updateNode(node, { next_node_id: event.target.value || null })}>
                <option value="">Ends here</option>
                {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <span className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">Answers</span>
            {node.options.length === 0 && <p className="m-0 text-[14px] text-[var(--muted)]">No answers yet.</p>}
            {node.options.map((option) => (
              <div key={option.id} className="grid gap-3 rounded-[8px] bg-[var(--surface-alt)] p-3 sm:grid-cols-4">
                <Field label="Label" htmlFor={`option-label-${option.id}`}>
                  <input id={`option-label-${option.id}`} className={small} defaultValue={option.label} maxLength={160} onBlur={(event) => { if (event.target.value !== option.label) updateOption(option, { label: event.target.value }); }} />
                </Field>
                <Field label="Ends with outcome" htmlFor={`option-key-${option.id}`}>
                  <OutcomeKeySelect id={`option-key-${option.id}`} value={option.disposition_key ?? ""} outcomes={config.dispositions} onChange={(value) => updateOption(option, { disposition_key: value || null })} />
                </Field>
                <Field label="Next question" htmlFor={`option-next-${option.id}`}>
                  <select id={`option-next-${option.id}`} className={small} value={option.next_node_id ?? ""} onChange={(event) => updateOption(option, { next_node_id: event.target.value || null })}>
                    <option value="">Ends call</option>
                    {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                  </select>
                </Field>
                <Field label="Note template" htmlFor={`option-note-${option.id}`}>
                  <input id={`option-note-${option.id}`} className={small} defaultValue={option.note_template ?? ""} maxLength={2000} onBlur={(event) => { if (event.target.value !== (option.note_template ?? "")) updateOption(option, { note_template: event.target.value || null }); }} />
                </Field>
              </div>
            ))}
          </div>
        </section>
      ))}

      {flow && (
        <form className="grid gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] p-4 sm:grid-cols-2" onSubmit={(event) => void createNode(event)}>
          <span className="text-[14px] font-semibold text-[var(--ink)] sm:col-span-2">Add a question</span>
          <Field label="Question key" htmlFor="new-node-key">
            <input id="new-node-key" className={small} required pattern="[a-z][a-z0-9_]{1,79}" value={newNode.node_key} onChange={(event) => setNewNode({ ...newNode, node_key: event.target.value })} />
          </Field>
          <Field label="Question" htmlFor="new-node-label">
            <input id="new-node-label" className={small} required maxLength={160} value={newNode.label} onChange={(event) => setNewNode({ ...newNode, label: event.target.value })} />
          </Field>
          <Field label="Prompt" htmlFor="new-node-prompt">
            <input id="new-node-prompt" className={small} required maxLength={2000} value={newNode.prompt} onChange={(event) => setNewNode({ ...newNode, prompt: event.target.value })} />
          </Field>
          <Field label="Question type" htmlFor="new-node-type">
            <select id="new-node-type" className={small} value={newNode.node_type} onChange={(event) => setNewNode({ ...newNode, node_type: event.target.value as DispositionNodeType })}>
              {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <button type="submit" className={btn("secondary", "justify-self-start sm:col-span-2")}>Add question</button>
        </form>
      )}

      {flow && (
        <form className="grid gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] p-4 sm:grid-cols-2" onSubmit={(event) => void createOption(event)}>
          <span className="text-[14px] font-semibold text-[var(--ink)] sm:col-span-2">Add an answer</span>
          <Field label="Question" htmlFor="new-option-node" className="sm:col-span-2">
            <select id="new-option-node" className={small} required value={newOption.node_id} onChange={(event) => setNewOption({ ...newOption, node_id: event.target.value })}>
              <option value="">Choose a question…</option>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </Field>
          <Field label="Answer key" htmlFor="new-option-key">
            <input id="new-option-key" className={small} required pattern="[a-z][a-z0-9_]{1,79}" value={newOption.option_key} onChange={(event) => setNewOption({ ...newOption, option_key: event.target.value })} />
          </Field>
          <Field label="Answer" htmlFor="new-option-label">
            <input id="new-option-label" className={small} required maxLength={160} value={newOption.label} onChange={(event) => setNewOption({ ...newOption, label: event.target.value })} />
          </Field>
          <Field label="Ends with outcome" htmlFor="new-option-disposition">
            <OutcomeKeySelect id="new-option-disposition" value={newOption.disposition_key} outcomes={config.dispositions} onChange={(value) => setNewOption({ ...newOption, disposition_key: value })} />
          </Field>
          <Field label="Note template" htmlFor="new-option-note">
            <input id="new-option-note" className={small} maxLength={2000} value={newOption.note_template} onChange={(event) => setNewOption({ ...newOption, note_template: event.target.value })} />
          </Field>
          <button type="submit" className={btn("secondary", "justify-self-start sm:col-span-2")}>Add answer</button>
        </form>
      )}
    </div>
  );
}

/* ── the wizard, read as a timeline ────────────────────────────────────── */

function wizardTimeline(flow: DispositionFlow, outcomes: Map<string, DispositionSettingsRow>) {
  const nodes = flow.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const destination = (index: number, nextId: string | null, outcomeKey: string | null) => {
    if (outcomeKey) {
      const outcome = outcomes.get(outcomeKey);
      const name = outcome?.label ?? outcomeKey;
      const closes = outcome ? closesAs(outcome) : null;
      return closes ? `${name}, closes as ${closes === "won" ? "Won" : "Lost"}` : `${name}, ends here`;
    }
    if (!nextId) return "ends here";
    if (nodes[index + 1]?.id === nextId) return "continue";
    return byId.get(nextId)?.label ?? "another question";
  };
  return nodes.map((node, index) => {
    const leadsToWon = node.options.some((option) => option.disposition_key && closesAs(outcomes.get(option.disposition_key) ?? ({} as DispositionSettingsRow)) === "won");
    const sub = node.node_type === "choice" && node.options.length > 0
      ? node.options.map((option) => `${option.label} → ${destination(index, option.next_node_id, option.disposition_key)}`).join(" · ")
      : `${NODE_TYPE_LABELS[node.node_type]} → ${destination(index, node.next_node_id, null)}`;
    return { title: node.label, sub, tone: leadsToWon ? ("success" as const) : ("primary" as const) };
  });
}

/* ── the section ───────────────────────────────────────────────────────── */

export function DispositionSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [flowId, setFlowId] = useState("");
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);

  async function load() {
    const response = await fetch("/api/app/dispositions/config", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setLoadError(body?.error ?? "Could not load disposition settings");
    else {
      setLoadError("");
      setConfig(body);
      setFlowId((current) => (current && body.flows?.some((flow: DispositionFlow) => flow.id === current) ? current : body.flows?.[0]?.id ?? ""));
    }
    setLoading(false);
  }

  // Settings are server state; hydrate once after the owner shell is mounted.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const endsCallAvailable = config?.ends_call_available !== false;
  const nextActionAvailable = config?.next_action_available === true;
  const pipelineList = useMemo(() => (config?.pipelines ?? []).map((pipeline) => pipeline.name), [config]);
  // A drafted stage shows as the row's mapped stage, so the table reads the way it will save.
  const rows = useMemo(() => (config?.dispositions ?? []).map((row): DispositionSettingsRow => {
    const { stage_id: stageId, ...edit } = edits[row.id] ?? {};
    const stage = stageId ? config?.stages.find((item) => item.id === stageId) : undefined;
    return {
      ...row,
      ...edit,
      mapped_stage: stage ? { id: stage.id, name: stage.name, stage_type: stage.stage_type, pipeline_id: stage.pipeline_id, pipeline_name: stage.pipeline_name } : row.mapped_stage,
    };
  }), [config, edits]);
  const savedById = useMemo(() => new Map((config?.dispositions ?? []).map((row) => [row.id, row])), [config]);
  const outcomesByKey = useMemo(() => new Map(rows.map((row) => [row.disposition_key, row])), [rows]);
  const dirtyIds = Object.keys(edits).filter((id) => Object.keys(edits[id]).length > 0);

  const visible = rows.filter((row) => {
    if (filters.status === "active" && !row.is_active) return false;
    if (filters.status === "archived" && row.is_active) return false;
    if (filters.work !== "any" && row.counts_as_work_completed !== (filters.work === "yes")) return false;
    if (filters.closes !== "any" && (closesAs(row) ?? "none") !== filters.closes) return false;
    const q = query.trim().toLowerCase();
    return !q || row.label.toLowerCase().includes(q) || row.disposition_key.includes(q);
  });

  function applyEdit(id: string, edit: Edit) {
    setEdits((current) => {
      const next = { ...current };
      if (Object.keys(edit).length === 0) delete next[id];
      else next[id] = edit;
      return next;
    });
    setSaveError("");
    setEditing(null);
  }

  async function saveAll() {
    setSaving(true);
    setSaveError("");
    const failures: string[] = [];
    const remaining: Record<string, Edit> = {};
    for (const id of dirtyIds) {
      const row = rows.find((item) => item.id === id);
      if (!row) continue;
      const edit = edits[id];
      try {
        await send({
          kind: "disposition",
          id,
          label: row.label,
          counts_as_work_completed: row.counts_as_work_completed,
          closes_as: row.closes_as,
          is_active: row.is_active,
          ...(edit.stage_id ? { stage_id: edit.stage_id } : {}),
          // The next action carries ends_call with it; before 20260924240200 only the flag can be stored.
          ...(nextActionAvailable && edit.next
            ? { next_action: edit.next.kind, next_action_minutes: edit.next.minutes }
            : edit.ends_call !== undefined && edit.ends_call !== null ? { ends_call: edit.ends_call } : {}),
        });
      } catch (error) {
        remaining[id] = edit;
        failures.push(`${row.label}: ${error instanceof Error ? error.message : "could not be saved"}`);
      }
    }
    await load();
    setEdits(remaining);
    setSaving(false);
    if (failures.length) setSaveError(failures.join(" "));
    else notify.done(dirtyIds.length === 1 ? "Outcome saved" : "Outcomes saved");
  }

  const header = config ? (
    <DraftActions dirty={dirtyIds.length > 0} saving={saving} onDiscard={() => { setEdits({}); setSaveError(""); }} onSave={() => void saveAll()} />
  ) : undefined;

  if (loading) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <SettingsCard><p className="m-0 text-[14px] text-[var(--muted)]">Loading call outcomes…</p></SettingsCard>
      </SettingsStack>
    );
  }
  if (!config) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title="Call outcomes could not be loaded">
          {loadError}
          <div className="mt-3"><button type="button" className={btn("secondary")} onClick={() => { setLoading(true); void load(); }}>Try again</button></div>
        </Callout>
      </SettingsStack>
    );
  }

  const flow = config.flows.find((item) => item.id === flowId) ?? null;
  const activeRows = rows.filter((row) => row.is_active);
  const unmapped = activeRows.filter((row) => !row.mapped_stage).length;
  const editingRow = editing ? rows.find((row) => row.id === editing) ?? null : null;
  const editingSaved = editing ? savedById.get(editing) ?? null : null;

  return (
    <SettingsStack>
      <SettingsSectionHeader actions={header} />

      <Callout tone="info" title="Four flags decide everything downstream">
        Whether it counts as work (the scorecard), whether it ends the call (the dialer), what it closes as (the funnel), and its next action (the cadence). An outcome with none of them set is a note, not a disposition.
      </Callout>

      {!endsCallAvailable && (
        <Callout tone="warning" title="Ends call is read-only for now">
          This setting needs a database update that has not been applied yet. Until then the dialer uses its built-in list, and this column shows a dash.
        </Callout>
      )}
      {saveError && <Callout tone="error" title="Some changes were not saved">{saveError}</Callout>}

      <SettingsTableCard
        title="Call outcomes"
        actions={
          <TableToolbar>
            <SearchBox value={query} onChange={setQuery} placeholder="Search outcomes" label="Search outcomes" />
            <FiltersButton filters={filters} onChange={setFilters} />
            <span className="grow" />
            <button type="button" className={btn("primary")} onClick={() => setAdding(true)}>
              <PlusIcon />
              Add an outcome
            </button>
          </TableToolbar>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Outcome</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Counts as work</th>
              <th scope="col" className={cn(st.th, "w-[130px]")}>Ends call</th>
              <th scope="col" className={cn(st.th, "w-[170px]")}>Closes as</th>
              <th scope="col" className={cn(st.th, "w-[240px]")}>Next action</th>
              <th scope="col" className={cn(st.th, "w-[110px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className={cn(st.td, "py-6 text-center text-[var(--muted)]")}>
                  {rows.length === 0 ? "No call outcomes yet. Add the first one." : "No outcome matches the search and filters."}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const closes = closesAs(row);
              const next = nextActionText(row);
              const pending = Boolean(edits[row.id]);
              return (
                <tr key={row.id}>
                  <td className={st.td}>
                    <span className={cn("inline-flex flex-wrap items-center gap-2", !row.is_active && "text-[var(--muted)]")}>
                      {row.label}
                      {!row.is_active && <Pill tone="neutral">Archived</Pill>}
                      {pending && <Pill tone="warning" dot>Unsaved</Pill>}
                    </span>
                  </td>
                  <td className={st.td}><YesNo value={row.counts_as_work_completed} /></td>
                  <td className={st.td}><YesNo value={row.ends_call} /></td>
                  <td className={st.td}>{closes ? <Pill tone={closes === "won" ? "success" : "error"}>{closes === "won" ? "Won" : "Lost"}</Pill> : <span className="text-[var(--muted)]">—</span>}</td>
                  <td className={st.td}>
                    {next.main}
                    {next.sub && <span className={st.sub}>{next.sub}</span>}
                  </td>
                  <td className={st.td}>
                    <button type="button" className={btn("row")} onClick={() => setEditing(row.id)} aria-label={`Edit ${row.label}`}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SettingsTableCard>

      <SettingsGrid>
        <SettingsCard
          title={flow ? `The wizard behind “${flow.stage_name}”` : "The outcome wizard"}
          sub="One question at a time, so the outcome is structured rather than typed."
          action={config.flows.length > 0 ? <button type="button" className={btn("secondary")} onClick={() => setFlowEditorOpen(true)}>Edit questions</button> : undefined}
        >
          {config.flows.length > 1 && (
            <div className="mb-4">
              <label htmlFor="wizard-flow" className="sr-only">Wizard</label>
              <select id="wizard-flow" className={cn(control, "mt-0")} value={flowId} onChange={(event) => setFlowId(event.target.value)}>
                {config.flows.map((item) => <option key={item.id} value={item.id}>{item.stage_name} · {item.name}</option>)}
              </select>
            </div>
          )}
          {!flow ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">No wizard is configured yet. One is created for each pipeline stage.</p>
          ) : flow.nodes.length === 0 ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">This stage&apos;s wizard has no questions yet.</p>
          ) : (
            <Timeline items={wizardTimeline(flow, outcomesByKey)} />
          )}
        </SettingsCard>

        <SettingsCard title="Rules the editor enforces">
          <div className="flex flex-col gap-3">
            <Callout tone="error" title="Every outcome maps to a stage">
              Saving an outcome with no stage is refused, with the pipeline named. This is the single rule that keeps the board and the reports agreeing.
              {unmapped > 0 ? ` ${unmapped} of ${activeRows.length} active outcomes have no stage yet.` : ""}
            </Callout>
            <Callout tone="warning" title="“Callback” requires a time">
              The outcome cannot be saved without one, and the time is validated against the customer&rsquo;s calling window before the disposition is written.
            </Callout>
            <Callout tone="info" title="Deleting is archiving">
              An outcome used by a past call is archived, never removed &mdash; the history would otherwise read as blank.
            </Callout>
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsDialog open={Boolean(editingRow)} onOpenChange={(open) => { if (!open) setEditing(null); }} title={editingRow ? `Edit “${editingRow.label}”` : "Edit outcome"} description="What this outcome counts as, whether it ends the call, what happens next, and the stage it moves the lead to.">
        {editingRow && editingSaved && (
          <OutcomeEditor key={editingRow.id} row={editingRow} saved={editingSaved} stages={config.stages} pipelines={pipelineList} endsCallAvailable={endsCallAvailable} nextActionAvailable={nextActionAvailable} onApply={(edit) => applyEdit(editingRow.id, edit)} onClose={() => setEditing(null)} />
        )}
      </SettingsDialog>

      <SettingsDialog open={adding} onOpenChange={setAdding} title="Add an outcome" description="The wizard can offer it as soon as it is added. It saves now, not with Save changes.">
        {adding && <AddOutcome stages={config.stages} pipelines={pipelineList} endsCallAvailable={endsCallAvailable} nextActionAvailable={nextActionAvailable} onCreated={load} onClose={() => setAdding(false)} />}
      </SettingsDialog>

      <SettingsDialog open={flowEditorOpen} onOpenChange={setFlowEditorOpen} wide title="Edit the wizard" description="Questions, answers, and the outcome each answer ends with. Each edit saves as you make it.">
        {flowEditorOpen && <FlowEditor config={config} flowId={flowId} onFlowChange={setFlowId} reload={load} />}
      </SettingsDialog>
    </SettingsStack>
  );
}
