"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { inputControl } from "@/components/ui/field";
import { Switch, checkboxControl } from "@/components/app/settings/primitives";
import type { TemplateField, TemplateFormDefinition, TemplateLogic, TemplateRule, TemplateRuleGroup, TemplateRuleOp } from "@/lib/templates/constants";
import { RULE_OP_LABELS, cleanLogic, formLogicList, isRuleGroup, logicSentence, ruleAnswers, ruleNeedsValue, ruleOpsFor, starterRule } from "@/lib/templates/logic";

const small = cn(inputControl, "h-8 w-auto min-w-0 text-sm");

/** One rule: the question, how it is tested, and the answer. */
function RuleRow({ rule, candidates, onChange, onRemove }: { rule: TemplateRule; candidates: TemplateField[]; onChange: (rule: TemplateRule) => void; onRemove: () => void }) {
  const field = candidates.find((item) => item.field_key === rule.field_key) ?? null;
  const ops = ruleOpsFor(field);
  const answers = ruleAnswers(field);
  const pickField = (key: string) => { const next = candidates.find((item) => item.field_key === key); if (next) onChange(starterRule(next)); };
  const setOp = (op: TemplateRuleOp) => onChange({ field_key: rule.field_key, op, ...(ruleNeedsValue(op) ? (op === "one_of" ? { values: rule.values ?? (rule.value ? [rule.value] : []) } : { value: rule.value ?? answers?.[0]?.value ?? "" }) : {}) });
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2">
      <select aria-label="Question" className={cn(small, "flex-[1_1_140px]")} value={rule.field_key} onChange={(event) => pickField(event.target.value)}>
        {!field && <option value={rule.field_key}>A question no longer on the form</option>}
        {candidates.map((item) => <option key={item.field_key} value={item.field_key}>{item.label || "Untitled question"}</option>)}
      </select>
      <select aria-label="How it is tested" className={cn(small, "flex-[0_1_130px]")} value={rule.op} onChange={(event) => setOp(event.target.value as TemplateRuleOp)}>
        {(ops.includes(rule.op) ? ops : [rule.op, ...ops]).map((op) => <option key={op} value={op}>{RULE_OP_LABELS[op]}</option>)}
      </select>
      {ruleNeedsValue(rule.op) && (rule.op === "one_of" && answers ? (
        <div role="group" aria-label="Any of these answers" className="flex basis-full flex-wrap gap-x-3 gap-y-1 pt-1">
          {answers.map((answer) => (
            <label key={answer.value} className="flex items-center gap-1.5 text-sm text-[var(--body)]">
              <input type="checkbox" className={checkboxControl} checked={(rule.values ?? []).includes(answer.value)} onChange={(event) => onChange({ ...rule, values: event.target.checked ? [...(rule.values ?? []), answer.value] : (rule.values ?? []).filter((value) => value !== answer.value) })} />
              {answer.label}
            </label>
          ))}
        </div>
      ) : answers && rule.op !== "at_least" && rule.op !== "at_most" ? (
        <select aria-label="The answer" className={cn(small, "flex-[1_1_100px]")} value={rule.value ?? ""} onChange={(event) => onChange({ ...rule, value: event.target.value })}>
          {!answers.some((answer) => answer.value === rule.value) && <option value={rule.value ?? ""}>{rule.value || "Choose…"}</option>}
          {answers.map((answer) => <option key={answer.value} value={answer.value}>{answer.label}</option>)}
        </select>
      ) : (
        <input aria-label="The answer" className={cn(small, "flex-[1_1_80px]")} inputMode={/at_|age_/.test(rule.op) ? "numeric" : undefined} maxLength={120} value={rule.value ?? ""} onChange={(event) => onChange({ ...rule, value: event.target.value })} />
      ))}
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove this rule" title="Remove this rule" onClick={onRemove}><X aria-hidden="true" /></Button>
    </div>
  );
}

const joinWord = (match: "all" | "any") => (match === "all" ? "AND" : "OR");

/** A set of rules with its own all / any: the top level, or a group inside it. */
function RuleList({ logic, candidates, onChange, nested = false }: { logic: TemplateLogic | TemplateRuleGroup; candidates: TemplateField[]; onChange: (logic: TemplateLogic) => void; nested?: boolean }) {
  const set = (rules: TemplateLogic["rules"]) => onChange({ match: logic.match, rules });
  const first = candidates[0];
  return (
    <div className="flex flex-col gap-1.5">
      {logic.rules.map((item, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {index > 0 && <span className="self-start"><StatusChip tone={logic.match === "all" ? "action" : "info"} dot={false}>{joinWord(logic.match)}</StatusChip></span>}
          {isRuleGroup(item) ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] p-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <select aria-label="This group matches" className={cn(small, "h-7 text-xs")} value={item.match} onChange={(event) => set(logic.rules.map((other, at) => (at === index ? { ...item, match: event.target.value as "all" | "any" } : other)))}>
                  <option value="any">Any of these</option>
                  <option value="all">All of these</option>
                </select>
              </label>
              <RuleList nested logic={item} candidates={candidates} onChange={(group) => set(logic.rules.map((other, at) => (at === index ? { match: group.match, rules: group.rules.filter((rule): rule is TemplateRule => !isRuleGroup(rule)) } : other)))} />
            </div>
          ) : (
            <RuleRow rule={item} candidates={candidates} onChange={(rule) => set(logic.rules.map((other, at) => (at === index ? rule : other)))} onRemove={() => set(logic.rules.filter((_, at) => at !== index))} />
          )}
        </div>
      ))}
      {first && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button type="button" variant={nested ? "ghost" : "outline"} size="sm" onClick={() => set([...logic.rules, starterRule(first)])}><Plus aria-hidden="true" />{logic.rules.length ? `${logic.match === "all" ? "And" : "Or"} a rule` : "Add a rule"}</Button>
          {!nested && logic.rules.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => set([...logic.rules, { match: logic.match === "all" ? "any" : "all", rules: [starterRule(first), starterRule(candidates[1] ?? first)] }])}><Plus aria-hidden="true" />{logic.match === "all" ? "And" : "Or"} a group</Button>}
        </div>
      )}
    </div>
  );
}

/**
 * Inspector › Logic (board A3): "Show this question when all / any of these are true", rules and
 * groups joined by AND / OR, read back as one sentence; the hidden answer is cleared; page skips; and
 * every piece of logic on the form, each one a click away.
 */
export function LogicEditor({ field, fields, form, sectionKey, logic, onLogic, onPageSkip, onPick }: {
  field: TemplateField;
  fields: TemplateField[];
  form: TemplateFormDefinition;
  sectionKey: string;
  logic: TemplateLogic | null;
  onLogic: (logic: TemplateLogic | null) => void;
  onPageSkip: (sectionKey: string, logic: TemplateLogic | null) => void;
  onPick: (fieldKey: string | null, sectionKey: string) => void;
}) {
  const byKey = new Map(fields.map((item) => [item.field_key, item]));
  const labelOf = (key: string) => byKey.get(key)?.label ?? key;
  const onForm = form.sections.flatMap((section) => section.fields.map((placed) => byKey.get(placed.field_key))).filter((item): item is TemplateField => Boolean(item));
  const candidates = onForm.filter((item) => item.field_key !== field.field_key);
  const current: TemplateLogic = logic ?? { match: "all", rules: [] };
  const sentence = logicSentence(logic, labelOf);
  const [skipPage, setSkipPage] = useState(sectionKey);
  const page = form.sections.find((section) => section.section_key === skipPage) ?? form.sections[0];
  const pageCandidates = onForm.filter((item) => !page?.fields.some((placed) => placed.field_key === item.field_key));
  const skip: TemplateLogic = page?.skip_when ?? { match: "all", rules: [] };
  const all = formLogicList(form, fields);
  const h4 = "m-0 text-sm font-semibold text-[var(--ink)]";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--body)]">
          <span>Show this question when</span>
          <select aria-label="All or any" className={small} value={current.match} onChange={(event) => onLogic({ ...current, match: event.target.value as "all" | "any" })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          <span>of these are true</span>
        </div>
        {candidates.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">Add another question first: a rule reads another question’s answer.</p> : <RuleList logic={current} candidates={candidates} onChange={(next) => onLogic(cleanLogic(next) ? next : null)} />}
        <p className="m-0 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2 text-sm leading-[1.5] text-[var(--ink)]">{sentence ? `Shows when ${sentence}.` : "Always shows."}</p>
        {logic && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onLogic(null)}>Always show it</Button>}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
        <h4 className={h4}>When it is hidden</h4>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--body)]">Clear the answer</span>
          <Switch checked disabled label="Clear the answer" />
        </div>
        <p className="m-0 text-xs text-[var(--muted)]">A hidden answer is always cleared, so it never reaches the lead.</p>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <h4 className={h4}>Page rules</h4>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-[var(--body)]">
          <span>Skip page</span>
          <select aria-label="Page to skip" className={small} value={page?.section_key ?? ""} onChange={(event) => setSkipPage(event.target.value)}>
            {form.sections.map((section, index) => <option key={section.section_key} value={section.section_key}>{index + 1} · {section.label}</option>)}
          </select>
          <span>when</span>
          <select aria-label="All or any, for the page" className={small} value={skip.match} onChange={(event) => page && onPageSkip(page.section_key, { ...skip, match: event.target.value as "all" | "any" })}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          <span>of these are true</span>
        </div>
        {page && (pageCandidates.length ? <RuleList logic={skip} candidates={pageCandidates} onChange={(next) => onPageSkip(page.section_key, cleanLogic(next) ? next : null)} /> : <p className="m-0 text-sm text-[var(--muted)]">A page is skipped by questions on other pages; this form has none.</p>)}
        {page && page.skip_when && <p className="m-0 text-sm text-[var(--ink)]">Page {form.sections.indexOf(page) + 1} is skipped when {logicSentence(page.skip_when, labelOf)}.</p>}
      </div>

      <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3">
        <h4 className={cn(h4, "flex items-center gap-2")}>All logic on this form <StatusChip>{all.length}</StatusChip></h4>
        {all.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">No question on this form has rules yet.</p>}
        <ul className="m-0 list-none p-0">
          {all.map((item) => (
            <li key={`${item.kind}:${item.section_key}:${item.field_key ?? ""}`} className="border-t border-[var(--border)] first:border-t-0">
              <button type="button" className="flex w-full flex-col items-start gap-0.5 py-2 text-left hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]" onClick={() => onPick(item.field_key ?? null, item.section_key)}>
                <strong className="text-sm font-semibold text-[var(--ink)]">{item.title}</strong>
                <span className="text-xs text-[var(--muted)]">{item.sentence}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
