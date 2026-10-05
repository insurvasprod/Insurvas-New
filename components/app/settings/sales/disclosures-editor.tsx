"use client";

/**
 * One disclosure version, open (Settings › Sales › Disclosures, LA-3.10): its text and scope, the
 * rules that make it required, and its PDF. A platform row is read-only here; a draft is edited in
 * place; a published version's edits save as version N + 1 (the list component does the calls).
 *
 * A rule is AND: every condition must hold. A second rule is OR. Fields are the application's
 * canonical keys and the interview's answers (`health.<question_key>`).
 */

import { Fragment, useState, type ReactNode } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";

import { Field, SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { CANONICAL_GROUPS, isSensitiveKey } from "@/lib/applications/constants";
import { CLAUSE_OPS, CLAUSE_OP_LABEL, clauseValueText, parseClauseValue, parseStates, type ClauseOp } from "@/lib/salesSettings/editing";
import type { DisclosureInput, DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { checkbox } from "./shared";

const STATE_CODES = US_STATES.map(([code]) => code as string);
const CANONICAL = CANONICAL_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => !isSensitiveKey(f.key)) }));
const CANONICAL_BY_KEY = new Map(CANONICAL.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));

export type ClauseDraft = { field: string; op: ClauseOp; text: string };
export type DisclosureDraft = { code: string; title: string; body: string; statesText: string; carrierIds: string[]; rules: { clauses: ClauseDraft[] }[] };

export function fieldKind(key: string, library: Pick<DisclosureLibrary, "interviewFields">) {
  if (key.startsWith("health.")) return { boolean: library.interviewFields.find((f) => f.key === key)?.type === "boolean", money: false };
  const input = CANONICAL_BY_KEY.get(key)?.input;
  return { boolean: input === "boolean", money: input === "money" };
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
  else if (Object.keys(clauseErrors).length) error = "Fix the conditions marked below.";
  return { input: { code: draft.code, title: draft.title.trim(), body: draft.body, states, carrier_ids: draft.carrierIds, rules }, clauseErrors, error };
}

function RuleEditor({ draft, setDraft, readOnly, library, clauseErrors }: {
  draft: DisclosureDraft; setDraft: (d: DisclosureDraft) => void; readOnly: boolean; library: DisclosureLibrary; clauseErrors: Record<string, string>;
}) {
  const rules = draft.rules;
  const set = (next: DisclosureDraft["rules"]) => setDraft({ ...draft, rules: next });
  const firstField = library.interviewFields[0]?.key ?? "addr.state";
  const setClause = (r: number, c: number, patch: Partial<ClauseDraft>) => set(rules.map((rule, i) => (i !== r ? rule : { clauses: rule.clauses.map((cl, j) => (j === c ? { ...cl, ...patch } : cl)) })));
  const removeClause = (r: number, c: number) => set(rules.map((rule, i) => (i !== r ? rule : { clauses: rule.clauses.filter((_, j) => j !== c) })).filter((rule) => rule.clauses.length > 0));
  const addClause = (r: number) => set(rules.map((rule, i) => (i !== r ? rule : { clauses: [...rule.clauses, { field: "addr.state", op: "eq", text: "" }] })));

  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 && <p className="m-0 text-[14px] text-[var(--muted)]">No rule yet — this document is never required on its own.</p>}
      {rules.map((rule, r) => (
        <Fragment key={r}>
          {r > 0 && <p className="m-0 text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">or</p>}
          <div className="border-l-2 border-[var(--border-strong)] py-1 pl-3">
            <div className="flex flex-col gap-2">
              {rule.clauses.map((cl, c) => {
                const id = `dc-r${r}-c${c}`;
                const err = clauseErrors[`${r}-${c}`];
                const kind = fieldKind(cl.field, library);
                const knownField = cl.field.startsWith("health.") ? library.interviewFields.some((f) => f.key === cl.field) : CANONICAL_BY_KEY.has(cl.field);
                return (
                  <div key={c}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-9 shrink-0 text-[12px] font-semibold uppercase text-[var(--muted)]">{c === 0 ? "If" : "and"}</span>
                      <select id={`${id}-field`} aria-label={`Rule ${r + 1}, condition ${c + 1}: field`} className={cn(control, "mt-0 w-auto min-w-[220px] flex-1")} value={cl.field} disabled={readOnly} onChange={(e) => setClause(r, c, { field: e.target.value })}>
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
                      <select aria-label={`Rule ${r + 1}, condition ${c + 1}: operator`} className={cn(control, "mt-0 w-[150px]")} value={cl.op} disabled={readOnly} onChange={(e) => setClause(r, c, { op: e.target.value as ClauseOp })}>
                        {CLAUSE_OPS.map((op) => <option key={op} value={op}>{CLAUSE_OP_LABEL[op]}</option>)}
                      </select>
                      <input
                        aria-label={`Rule ${r + 1}, condition ${c + 1}: value`}
                        aria-invalid={Boolean(err) || undefined}
                        className={cn(control, "mt-0 w-[180px]", err && "border-[var(--error)]")}
                        value={cl.text}
                        disabled={readOnly}
                        placeholder={cl.op === "in" || cl.op === "not_in" ? "TX, OK" : kind.boolean ? "yes or no" : kind.money ? "$ amount" : "value"}
                        onChange={(e) => setClause(r, c, { text: e.target.value })}
                      />
                      {!readOnly && (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove condition ${c + 1} from rule ${r + 1}`} onClick={() => removeClause(r, c)}><Trash2 aria-hidden="true" /></Button>
                      )}
                    </div>
                    {err && <p role="alert" className="m-0 mt-1 pl-11 text-[12px] leading-[1.5] text-[var(--error-ink)]">{err}</p>}
                  </div>
                );
              })}
            </div>
            {!readOnly && (
              <div className="mt-2 pl-11">
                <Button type="button" variant="ghost" size="sm" onClick={() => addClause(r)}><Plus aria-hidden="true" />Add a condition</Button>
              </div>
            )}
          </div>
        </Fragment>
      ))}
      {!readOnly && (
        <div>
          <Button type="button" variant="outline" onClick={() => set([...rules, { clauses: [{ field: firstField, op: "eq", text: "" }] }])}><Plus aria-hidden="true" />Add a rule</Button>
        </div>
      )}
    </div>
  );
}

export function DisclosureEditor({ item, draft, setDraft, library, readOnly, clauseErrors, onAttach, onOpenPdf, busy, action }: {
  item: DisclosureItem | null;
  draft: DisclosureDraft;
  setDraft: (d: DisclosureDraft) => void;
  library: DisclosureLibrary;
  readOnly: boolean;
  clauseErrors: Record<string, string>;
  onAttach: (file: File) => void;
  onOpenPdf: () => void;
  busy: boolean;
  /** The document card's top-right: its status pill, or "Copy to my agency" on a platform row. */
  action?: ReactNode;
}) {
  const set = (patch: Partial<DisclosureDraft>) => setDraft({ ...draft, ...patch });
  const [fileKey, setFileKey] = useState(0);
  // A code is fixed once it has history: a published version, or a draft that follows one (a copy of an Insurvas document included).
  const codeFixed = readOnly || (item !== null && (item.status !== "draft" || item.version > 1));
  const canAttach = !readOnly && item !== null && item.status === "draft";
  const knownCarriers = new Set(library.carriers.map((c) => c.id));
  const extraCarriers = draft.carrierIds.filter((id) => !knownCarriers.has(id));

  const pdfHint = item === null ? "Save the draft first, then attach its PDF."
    : item.status !== "draft" && !readOnly ? "A published version keeps its PDF. Saving makes a new version, which can have its own."
    : "Optional. A PDF of at most 10 MB, stored privately.";

  return (
    <>
      <SettingsCard title="The document" action={action} sub={
        item === null ? "A new document starts as a draft. It applies to nothing until it is published."
          : item.platform ? `Insurvas wording, version ${item.version}. Copy it to your agency to change it.`
          : item.status === "published" ? `Saving makes version ${item.version + 1} as a draft. ${item.acknowledged ? `The ${item.acknowledged} application${item.acknowledged === 1 ? "" : "s"} acknowledged on version ${item.version} keep it.` : `Applications acknowledged on version ${item.version} keep it.`}`
          : item.status === "retired" ? `Version ${item.version} is retired — superseded or withdrawn. It stays readable because applications acknowledged on it still point at it.`
          : `Version ${item.version} is a draft — it applies to nothing until it is published.`
      }>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
            <Field label="Code" htmlFor="dc-code" required hint={codeFixed ? undefined : "Capital letters, digits and _."}>
              <input id="dc-code" className={cn(control, "font-mono uppercase")} value={draft.code} disabled={codeFixed} spellCheck={false} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
            </Field>
            <Field label="Title" htmlFor="dc-title" required>
              <input id="dc-title" className={control} value={draft.title} disabled={readOnly} onChange={(e) => set({ title: e.target.value })} />
            </Field>
          </div>
          <Field label="Text the agent reads or sends" htmlFor="dc-body" required>
            <textarea id="dc-body" rows={8} className={cn(control, "h-auto py-2 leading-[1.6]")} value={draft.body} disabled={readOnly} onChange={(e) => set({ body: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="States" htmlFor="dc-states" hint="Two-letter codes. Leave empty for every state.">
              <input id="dc-states" className={cn(control, "uppercase")} value={draft.statesText} disabled={readOnly} placeholder="All states" onChange={(e) => set({ statesText: e.target.value })} />
            </Field>
            <Field label="PDF attachment" htmlFor="dc-pdf" hint={pdfHint}>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {item?.hasAttachment && (
                  <Button type="button" variant="outline" onClick={onOpenPdf}><FileText aria-hidden="true" />Open the PDF</Button>
                )}
                {canAttach && (
                  <input
                    key={fileKey}
                    id="dc-pdf"
                    type="file"
                    accept="application/pdf"
                    disabled={busy}
                    className={cn(control, "mt-0 w-auto flex-1 py-1.5 file:mr-3 file:rounded-[6px] file:border-0 file:bg-[var(--surface-alt)] file:px-2.5 file:py-0.5 file:text-[14px] file:font-semibold file:text-[var(--ink)]")}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { onAttach(f); setFileKey((k) => k + 1); } }}
                  />
                )}
                {!item?.hasAttachment && !canAttach && <span className="text-[14px] text-[var(--muted)]">None</span>}
              </div>
            </Field>
          </div>
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="p-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Carriers</legend>
            {library.carriers.length === 0 && extraCarriers.length === 0 ? (
              <span className="mt-1.5 block text-[14px] text-[var(--muted)]">Every carrier. Add carriers to your agency in Carriers &amp; products to limit it to some.</span>
            ) : (
              <>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
                  {library.carriers.map((c) => (
                    <label key={c.id} className="inline-flex items-center gap-2 text-[14px] text-[var(--body)]">
                      <input type="checkbox" className={checkbox} disabled={readOnly} checked={draft.carrierIds.includes(c.id)} onChange={(e) => set({ carrierIds: e.target.checked ? [...draft.carrierIds, c.id] : draft.carrierIds.filter((x) => x !== c.id) })} />
                      {c.name}
                    </label>
                  ))}
                  {extraCarriers.map((id) => (
                    <label key={id} className="inline-flex items-center gap-2 text-[14px] text-[var(--muted)]" title="A carrier your agency no longer has">
                      <input type="checkbox" className={checkbox} disabled={readOnly} checked onChange={() => set({ carrierIds: draft.carrierIds.filter((x) => x !== id) })} />
                      Former carrier
                    </label>
                  ))}
                </div>
                <span className="mt-1.5 block text-[12px] leading-[1.5] text-[var(--muted)]">None ticked means every carrier.</span>
              </>
            )}
          </fieldset>
        </div>
      </SettingsCard>

      <SettingsCard title="When it is required" sub="Every condition in a rule must hold. If it needs an OR, add a second rule.">
        <RuleEditor draft={draft} setDraft={setDraft} readOnly={readOnly} library={library} clauseErrors={clauseErrors} />
      </SettingsCard>
    </>
  );
}

