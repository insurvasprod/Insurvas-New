"use client";

/**
 * One disclosure version, open (Settings › Sales › Disclosures, LA-3.10; board A, 2026-10-30): its
 * wording and PDF, where and when it applies (states, carriers, the rules that make it required). A
 * platform row is read-only here; a draft is edited in place; a published version's edits save as
 * version N + 1 (the list component does the calls).
 *
 * A rule is AND: every condition must hold. A second rule is OR. Fields are the application's
 * canonical keys and the interview's answers (`health.<question_key>`).
 */

import { Fragment, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Copy, FileText, Plus, X } from "lucide-react";

import { Field, SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { CANONICAL_GROUPS, isSensitiveKey } from "@/lib/applications/constants";
import { notify } from "@/lib/notify";
import { readAloudLine } from "@/lib/salesSettings/disclosureLibrary";
import { CLAUSE_OPS, CLAUSE_OP_LABEL, clauseValueText, describeClause, parseClauseValue, parseStates, type ClauseOp } from "@/lib/salesSettings/editing";
import type { DisclosureInput, DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { WithReason, checkbox } from "./shared";

const STATE_CODES = US_STATES.map(([code]) => code as string);
const STATE_NAME = new Map(US_STATES.map(([code, name]) => [code as string, name as string]));
const CANONICAL = CANONICAL_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => !isSensitiveKey(f.key)) }));
const CANONICAL_BY_KEY = new Map(CANONICAL.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));

export type ClauseDraft = { field: string; op: ClauseOp; text: string };
export type DisclosureDraft = { code: string; title: string; body: string; statesText: string; carrierIds: string[]; rules: { clauses: ClauseDraft[] }[] };
/** The panel's own setter, so a late Undo applies to the draft as it is then, not as it was. */
export type SetDraft = Dispatch<SetStateAction<DisclosureDraft | null>>;

export function fieldKind(key: string, library: Pick<DisclosureLibrary, "interviewFields">) {
  if (key.startsWith("health.")) return { boolean: library.interviewFields.find((f) => f.key === key)?.type === "boolean", money: false, state: false };
  const input = CANONICAL_BY_KEY.get(key)?.input;
  return { boolean: input === "boolean", money: input === "money", state: input === "state" };
}

export function fieldLabel(key: string, library: Pick<DisclosureLibrary, "interviewFields">) {
  if (key.startsWith("health.")) return library.interviewFields.find((f) => f.key === key)?.label ?? key.slice(7).replace(/_/g, " ");
  return CANONICAL_BY_KEY.get(key)?.label ?? key;
}

export function toDraft(item: DisclosureItem | null, library: Pick<DisclosureLibrary, "interviewFields">): DisclosureDraft {
  if (!item) return { code: "", title: "", body: "", statesText: "", carrierIds: [], rules: [] };
  return {
    code: item.code, title: item.title, body: item.body, statesText: item.states.join(", "), carrierIds: [...item.carrierIds],
    rules: item.rules.map((r) => ({ clauses: r.clauses.map((c) => ({ field: c.field, op: c.op, text: clauseValueText(c, fieldKind(c.field, library)) })) })),
  };
}

/** The draft as the API's body, or the first thing wrong with it (named, so it can be fixed). */
export function toInput(draft: DisclosureDraft, library: Pick<DisclosureLibrary, "interviewFields">): { input: DisclosureInput; clauseErrors: Record<string, string>; error: string | null } {
  const clauseErrors: Record<string, string> = {};
  const { states, unknown } = parseStates(draft.statesText, STATE_CODES);
  const rules = draft.rules.map((rule, r) => ({
    clauses: rule.clauses.map((c, i) => {
      const parsed = parseClauseValue(c.op, c.text, fieldKind(c.field, library));
      if ("error" in parsed) {
        clauseErrors[`${r}-${i}`] = parsed.error;
        return { field: c.field, op: c.op, value: "" };
      }
      return { field: c.field, op: c.op, value: parsed.value as DisclosureInput["rules"][number]["clauses"][number]["value"] };
    }),
  }));
  let error: string | null = null;
  if (!/^[A-Z0-9][A-Z0-9_]{1,63}$/.test(draft.code)) error = "Give it a code in capital letters, digits and _ — like REPLACEMENT_NOTICE.";
  else if (!draft.title.trim()) error = "Give the document a title.";
  else if (!draft.body.trim()) error = "Write the text the agent reads or sends.";
  else if (unknown.length) error = `${unknown.join(", ")} ${unknown.length === 1 ? "isn't a US state code" : "aren't US state codes"}.`;
  else if (Object.keys(clauseErrors).length) error = "Fix the conditions marked under Where and when.";
  return { input: { code: draft.code, title: draft.title.trim(), body: draft.body, states, carrier_ids: draft.carrierIds, rules }, clauseErrors, error };
}

/** "If has life insurance now = yes AND state is one of TX" — a rule read back as a sentence. */
export function ruleSentence(clauses: DisclosureItem["rules"][number]["clauses"], library: Pick<DisclosureLibrary, "interviewFields">) {
  return clauses.map((c) => describeClause(c, fieldLabel(c.field, library).toLowerCase(), fieldKind(c.field, library))).join(" AND ");
}

/* ── wording ─────────────────────────────────────────────────────────────── */

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Uploads one PDF, reporting progress; rejects with the reason to show. */
export type PdfUpload = (file: File, onProgress: (sent: number) => void, signal: AbortSignal) => Promise<void>;

function PdfField({ item, readOnly, busy, onUpload, onOpenPdf, onRemovePdf }: {
  item: DisclosureItem | null;
  readOnly: boolean;
  busy: boolean;
  onUpload: PdfUpload;
  onOpenPdf: () => void;
  onRemovePdf: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState<{ name: string; size: number; sent: number } | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [over, setOver] = useState(false);
  const canAttach = !readOnly && item !== null && item.status === "draft";

  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) return setProblem({ title: "Attach a PDF file.", detail: `${file.name} isn't a PDF.` });
    if (file.size > MAX_PDF_BYTES) return setProblem({ title: "The PDF must be 10 MB or smaller.", detail: `${file.name} is ${kb(file.size)}. Save it at a lower quality and try again.` });
    const controller = new AbortController();
    abort.current = controller;
    setUploading({ name: file.name, size: file.size, sent: 0 });
    try {
      await onUpload(file, (sent) => setUploading((u) => (u ? { ...u, sent } : u)), controller.signal);
    } catch (e) {
      if (!controller.signal.aborted) setProblem({ title: e instanceof Error ? e.message : "The PDF could not be attached.", detail: file.name });
    } finally {
      abort.current = null;
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  const choose = () => input.current?.click();
  const fileRow = "m-glass-inset flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3";
  const icon = <span aria-hidden="true" className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-alt)]"><FileText className="size-4" /></span>;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">PDF</span>
      <input ref={input} id="dc-pdf" type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-label="Choose a PDF" onChange={(e) => take(e.target.files?.[0])} />
      {uploading ? (
        <div className={fileRow} role="status">
          {icon}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-sm font-semibold text-[var(--ink)]">{uploading.name}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-200" style={{ width: `${Math.round((uploading.sent / Math.max(1, uploading.size)) * 100)}%` }} /></span>
            <span className="text-xs text-[var(--muted)]">Uploading · {kb(uploading.sent)} of {kb(uploading.size)}</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => abort.current?.abort()}>Cancel</Button>
        </div>
      ) : item?.hasAttachment ? (
        <div className={fileRow}>
          {icon}
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">{item.code.toLowerCase()}-v{item.version}.pdf</span>
            <span className="block text-xs text-[var(--muted)]">{canAttach ? "Attached to this draft" : `Part of what ${item.acknowledged} ${item.acknowledged === 1 ? "application" : "applications"} acknowledged on v${item.version}, so it can't be changed`}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenPdf}>Open</Button>
          {canAttach && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={choose}>Replace</Button>}
          {canAttach && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemovePdf} className="text-[var(--error-ink)]">Remove</Button>}
        </div>
      ) : canAttach ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
          className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed p-5 text-center transition-colors duration-150", over ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-[var(--border-strong)]")}
        >
          <span className="text-sm font-semibold text-[var(--ink)]">Drop the carrier&apos;s or the state&apos;s PDF here</span>
          <Button type="button" variant="outline" disabled={busy} onClick={choose}>Choose a file</Button>
          <span className="text-xs text-[var(--muted)]">PDF only, up to 10 MB. Stored privately; it opens through a link that lasts a minute.</span>
        </div>
      ) : (
        <span className="text-sm text-[var(--muted)]">{item === null ? "Save the draft first, then attach its PDF." : readOnly ? "None" : "None. To add one, edit the document: saving starts a new draft, which can have its own PDF."}</span>
      )}
      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--error)] bg-[var(--error-surface)] p-3">
          <div className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">{problem.title}</span>
            <span className="block text-xs text-[var(--body)]">{problem.detail}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={choose}>Choose another file</Button>
        </div>
      )}
    </div>
  );
}

export function WordingFields({ item, draft, setDraft, readOnly, onUpload, onOpenPdf, onRemovePdf, busy }: {
  item: DisclosureItem | null;
  draft: DisclosureDraft;
  setDraft: SetDraft;
  readOnly: boolean;
  onUpload: PdfUpload;
  onOpenPdf: () => void;
  onRemovePdf: () => void;
  busy: boolean;
}) {
  const set = (patch: Partial<DisclosureDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  // A code is fixed once it has history: a published version, or a draft that follows one (a copy of an Insurvas document included).
  const codeFixed = readOnly || (item !== null && (item.status !== "draft" || item.version > 1));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.body);
      notify.done("Wording copied");
    } catch {
      notify.block("The wording could not be copied. Select it and copy it instead.");
    }
  };

  return (
    <SettingsCard>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
          <Field label="Code" htmlFor="dc-code" required hint={codeFixed ? "Fixed once a version has been published." : "Capital letters, digits and _."}>
            <input id="dc-code" className={cn(control, "font-mono uppercase")} value={draft.code} disabled={codeFixed} spellCheck={false} placeholder="TX_REPLACEMENT" onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
          </Field>
          <Field label="Title" htmlFor="dc-title" required>
            <input id="dc-title" className={control} value={draft.title} disabled={readOnly} placeholder="Texas replacement notice" onChange={(e) => set({ title: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="dc-body" className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">What the agent reads or sends <span className="text-[var(--error-ink)]">*</span></label>
            <Button type="button" variant="ghost" size="sm" disabled={!draft.body.trim()} onClick={copy}><Copy aria-hidden="true" />Copy wording</Button>
          </div>
          <textarea id="dc-body" rows={9} maxLength={20000} className={cn(control, "mt-0 h-auto py-2 leading-[1.6]")} value={draft.body} disabled={readOnly} placeholder="Write it the way the agent will say it." onChange={(e) => set({ body: e.target.value })} />
          <span className="text-xs leading-[1.5] text-[var(--muted)]">{readAloudLine(draft.body)} · 20,000 characters at most</span>
        </div>
        <PdfField item={item} readOnly={readOnly} busy={busy} onUpload={onUpload} onOpenPdf={onOpenPdf} onRemovePdf={onRemovePdf} />
      </div>
    </SettingsCard>
  );
}

/* ── where and when ──────────────────────────────────────────────────────── */

function StatePicker({ value, onChange, readOnly }: { value: string; onChange: (text: string) => void; readOnly: boolean }) {
  const { states } = parseStates(value, STATE_CODES);
  const picked = new Set(states);
  const toggle = (code: string) => onChange(STATE_CODES.filter((c) => (c === code ? !picked.has(c) : picked.has(c))).join(", "));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-[var(--body)]">{states.length ? `${states.length} picked: ${states.join(", ")}` : "Every state"}</span>
        {!readOnly && states.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>Every state</Button>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5" role="group" aria-label="States">
        {STATE_CODES.map((code) => (
          <Button
            key={code}
            type="button"
            size="sm"
            variant={picked.has(code) ? "default" : "outline"}
            aria-pressed={picked.has(code)}
            aria-label={STATE_NAME.get(code) ?? code}
            title={STATE_NAME.get(code)}
            disabled={readOnly}
            onClick={() => toggle(code)}
            className="px-0 font-mono"
          >
            {code}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** "is one of" on a state field: the picked states as removable chips and a list to add one. */
function StateValue({ text, onChange, readOnly, label }: { text: string; onChange: (text: string) => void; readOnly: boolean; label: string }) {
  const { states } = parseStates(text, STATE_CODES);
  const set = (next: string[]) => onChange(STATE_CODES.filter((c) => next.includes(c)).join(", "));
  return (
    <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-1.5">
      {states.map((code) => (
        <ToggleChip key={code} onRemove={readOnly ? undefined : () => set(states.filter((s) => s !== code))} disabled={readOnly}>{code}</ToggleChip>
      ))}
      {!readOnly && (
        <select aria-label={`${label}: add a state`} className={cn(control, "mt-0 w-[130px]")} value="" onChange={(e) => e.target.value && set([...states, e.target.value])}>
          <option value="">+ State</option>
          {STATE_CODES.filter((c) => !states.includes(c)).map((c) => <option key={c} value={c}>{STATE_NAME.get(c) ?? c}</option>)}
        </select>
      )}
    </div>
  );
}

function RuleEditor({ draft, setDraft, readOnly, library, clauseErrors }: {
  draft: DisclosureDraft; setDraft: SetDraft; readOnly: boolean; library: DisclosureLibrary; clauseErrors: Record<string, string>;
}) {
  const rules = draft.rules;
  const setRules = (fn: (rules: DisclosureDraft["rules"]) => DisclosureDraft["rules"]) => setDraft((d) => (d ? { ...d, rules: fn(d.rules) } : d));
  const firstField = library.interviewFields[0]?.key ?? "addr.state";
  const fieldOf = (key: string): Partial<ClauseDraft> => {
    const kind = fieldKind(key, library);
    return kind.boolean ? { op: "eq", text: "yes" } : kind.state ? { op: "in", text: "" } : {};
  };
  const setClause = (r: number, c: number, patch: Partial<ClauseDraft>) => setRules((all) => all.map((rule, i) => (i !== r ? rule : { clauses: rule.clauses.map((cl, j) => (j === c ? { ...cl, ...patch } : cl)) })));
  const removeClause = (r: number, c: number) => {
    if (rules[r]?.clauses.length === 1) return removeRule(r);
    setRules((all) => all.map((rule, i) => (i !== r ? rule : { clauses: rule.clauses.filter((_, j) => j !== c) })));
  };
  const addClause = (r: number) => setRules((all) => all.map((rule, i) => (i !== r ? rule : { clauses: [...rule.clauses, { field: "addr.state", op: "in", text: "" }] })));
  const addRule = () => setRules((all) => [...all, { clauses: [{ field: firstField, op: "eq", text: "", ...fieldOf(firstField) }] }]);
  const duplicateRule = (r: number) => setRules((all) => [...all.slice(0, r + 1), { clauses: all[r].clauses.map((c) => ({ ...c })) }, ...all.slice(r + 1)]);
  function removeRule(r: number) {
    const removed = rules[r];
    setRules((all) => all.filter((_, i) => i !== r));
    // Long enough to reach Undo; a plain save's 3 s is not.
    notify.done(`Rule ${r + 1} removed`, { durationMs: 8000, action: { label: "Undo", onClick: () => setRules((all) => [...all.slice(0, r), removed, ...all.slice(r)]) } });
  }

  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 && <p className="m-0 text-sm text-[var(--warning-ink)]">No rule yet — nothing requires this document, so no application will carry it.</p>}
      {rules.map((rule, r) => (
        <Fragment key={r}>
          {r > 0 && (
            <div className="flex items-center gap-2 text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border)]" />or<span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          )}
          <section aria-label={`Rule ${r + 1}`} className="m-glass-inset flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-sm font-semibold text-[var(--ink)]">Rule {r + 1}</span>
              {!readOnly && (
                <>
                  <Button type="button" variant="ghost" size="sm" disabled={rules.length >= 10} onClick={() => duplicateRule(r)}>Duplicate</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" onClick={() => removeRule(r)}>Remove rule</Button>
                </>
              )}
            </div>
            {rule.clauses.map((cl, c) => {
              const id = `dc-r${r}-c${c}`;
              const err = clauseErrors[`${r}-${c}`];
              const kind = fieldKind(cl.field, library);
              const list = cl.op === "in" || cl.op === "not_in";
              const yesNo = kind.boolean && (cl.op === "eq" || cl.op === "neq");
              const knownField = cl.field.startsWith("health.") ? library.interviewFields.some((f) => f.key === cl.field) : CANONICAL_BY_KEY.has(cl.field);
              const name = `Rule ${r + 1}, condition ${c + 1}`;
              return (
                <div key={c}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-9 shrink-0 text-xs font-semibold uppercase text-[var(--muted)]">{c === 0 ? "If" : "and"}</span>
                    <select id={`${id}-field`} aria-label={`${name}: field`} className={cn(control, "mt-0 w-auto min-w-[220px] flex-1")} value={cl.field} disabled={readOnly} onChange={(e) => setClause(r, c, { field: e.target.value, ...fieldOf(e.target.value) })}>
                      {!knownField && <option value={cl.field}>{cl.field}</option>}
                      {library.interviewFields.length > 0 && (
                        <optgroup label="Interview">
                          {library.interviewFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </optgroup>
                      )}
                      {CANONICAL.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {g.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <select aria-label={`${name}: operator`} className={cn(control, "mt-0 w-[150px]")} value={cl.op} disabled={readOnly} onChange={(e) => setClause(r, c, { op: e.target.value as ClauseOp })}>
                      {CLAUSE_OPS.map((op) => <option key={op} value={op}>{CLAUSE_OP_LABEL[op]}</option>)}
                    </select>
                    {yesNo ? (
                      <div role="radiogroup" aria-label={`${name}: value`} className="flex gap-1.5">
                        {(["yes", "no"] as const).map((v) => (
                          <ToggleChip key={v} role="radio" selected={cl.text === v} disabled={readOnly} onClick={() => setClause(r, c, { text: v })}>{v === "yes" ? "Yes" : "No"}</ToggleChip>
                        ))}
                      </div>
                    ) : kind.state && list ? (
                      <StateValue text={cl.text} readOnly={readOnly} label={name} onChange={(text) => setClause(r, c, { text })} />
                    ) : (
                      <input
                        aria-label={`${name}: value`}
                        aria-invalid={Boolean(err) || undefined}
                        className={cn(control, "mt-0 w-[180px]", err && "border-[var(--error)]")}
                        value={cl.text}
                        disabled={readOnly}
                        placeholder={list ? "TX, OK" : kind.boolean ? "yes or no" : kind.money ? "$ amount" : "value"}
                        onChange={(e) => setClause(r, c, { text: e.target.value })}
                      />
                    )}
                    {!readOnly && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove condition ${c + 1} from rule ${r + 1}`} onClick={() => removeClause(r, c)}><X aria-hidden="true" /></Button>
                    )}
                  </div>
                  {err && <p role="alert" className="m-0 mt-1 pl-11 text-xs leading-[1.5] text-[var(--error-ink)]">{err}</p>}
                </div>
              );
            })}
            {!readOnly && (
              <div className="pl-11">
                <Button type="button" variant="ghost" size="sm" disabled={rule.clauses.length >= 10} onClick={() => addClause(r)}><Plus aria-hidden="true" />Add a condition</Button>
              </div>
            )}
          </section>
        </Fragment>
      ))}
      {!readOnly && (
        <div>
          <WithReason reason={rules.length >= 10 ? "A document has at most 10 rules." : null}>
            <Button type="button" variant="outline" disabled={rules.length >= 10} onClick={addRule}><Plus aria-hidden="true" />{rules.length ? "Add another rule (or)" : "Add a rule"}</Button>
          </WithReason>
        </div>
      )}
    </div>
  );
}

export function ScopeFields({ draft, setDraft, library, readOnly, clauseErrors }: {
  draft: DisclosureDraft;
  setDraft: SetDraft;
  library: DisclosureLibrary;
  readOnly: boolean;
  clauseErrors: Record<string, string>;
}) {
  const set = (patch: Partial<DisclosureDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const knownCarriers = new Set(library.carriers.map((c) => c.id));
  const extraCarriers = draft.carrierIds.filter((id) => !knownCarriers.has(id));

  return (
    <>
      <SettingsCard title="States" info="The client's state on the application. None picked means every state.">
        <StatePicker value={draft.statesText} readOnly={readOnly} onChange={(statesText) => set({ statesText })} />
      </SettingsCard>

      <SettingsCard title="Carriers" info="The carrier the application goes to. None ticked means every carrier.">
        {library.carriers.length === 0 && extraCarriers.length === 0 ? (
          <span className="block text-sm text-[var(--muted)]">Every carrier. Add carriers to your agency in Carriers to limit it to some.</span>
        ) : (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="sr-only">Carriers</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {library.carriers.map((c) => (
                <label key={c.id} className="inline-flex items-center gap-2 text-sm text-[var(--body)]">
                  <input type="checkbox" className={checkbox} disabled={readOnly} checked={draft.carrierIds.includes(c.id)} onChange={(e) => set({ carrierIds: e.target.checked ? [...draft.carrierIds, c.id] : draft.carrierIds.filter((x) => x !== c.id) })} />
                  {c.name}
                </label>
              ))}
              {extraCarriers.map((id) => (
                <label key={id} className="inline-flex items-center gap-2 text-sm text-[var(--muted)]" title="A carrier your agency no longer has">
                  <input type="checkbox" className={checkbox} disabled={readOnly} checked onChange={() => set({ carrierIds: draft.carrierIds.filter((x) => x !== id) })} />
                  Former carrier
                </label>
              ))}
            </div>
            <span className="mt-2 block text-xs leading-[1.5] text-[var(--muted)]">{draft.carrierIds.length ? `${draft.carrierIds.length} picked` : "None ticked: every carrier"}</span>
          </fieldset>
        )}
      </SettingsCard>

      <SettingsCard title="Required when" info="Every condition in a rule must hold. If it needs an OR, add another rule. The application attaches the document as soon as a rule holds. Up to 10 rules, 10 conditions each.">
        <RuleEditor draft={draft} setDraft={setDraft} readOnly={readOnly} library={library} clauseErrors={clauseErrors} />
      </SettingsCard>
    </>
  );
}
