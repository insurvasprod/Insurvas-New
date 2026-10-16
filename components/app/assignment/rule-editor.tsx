"use client";

import Link from "next/link";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Field, PlusIcon, control } from "@/components/app/settings/primitives";
import { CONDITION_TYPES, MATCH_LABEL, MATCH_TYPES, MAX_EXTRA_CONDITIONS, RULE_STRATEGIES, SCHEMA_PENDING_MESSAGE, STRATEGY_LABEL, nobodySentence, type AssignmentMember, type ConditionType, type MatchType, type PreviewRow, type RuleStrategy } from "@/lib/assignment/constants";
import { cn } from "@/lib/utils";
import { type ConditionDraft, type RuleDraft, conditionProblem, roleLabel } from "./model";

export function PreviewWhy({ row, ruleNumber, memberName }: { row: PreviewRow; ruleNumber: number | null; memberName: (id: string) => string }) {
  if (row.outcome === "taken") return <StatusChip dot={false}>Already taken</StatusChip>;
  if (row.outcome === "error") return <StatusChip dot={false} tone="danger">{row.error ?? "Could not route"}</StatusChip>;
  if (row.outcome === "nobody") {
    const d = row.detail ?? {};
    const other = (d.capacity ?? 0) + (d.rest ?? 0) + (d.household ?? 0) + (d.day_off ?? 0) + (d.language ?? 0);
    const label = !d.candidates ? "No one on the rule"
      : !d.state && (d.licence ?? 0) > 0 && !other ? "No state"
      : (d.licence ?? 0) > 0 && !other ? "Off-territory"
      : (d.capacity ?? 0) > 0 && (d.capacity ?? 0) + (d.licence ?? 0) === d.candidates ? "Everyone full"
      : (d.household ?? 0) > 0 || (d.rest ?? 0) > 0 ? "Household held"
      : "No one eligible";
    return <span title={nobodySentence(row.detail)}><StatusChip dot={false} tone="danger">{label}</StatusChip></span>;
  }
  if (row.setter_without_licensed_agent) return <StatusChip dot={false} tone="info">No licence &mdash; setter</StatusChip>;
  const base = ruleNumber ? `Rule ${ruleNumber}` : "Whole roster";
  const full = row.full_user_ids[0];
  return <StatusChip dot={false}>{full ? <>{base} &mdash; {memberName(full)} full</> : base}</StatusChip>;
}

/** The expanded editor under a rule row. */
export function RuleEditor({
  draft, index, total, members, campaigns, allCampaigns, routerSchema, campaignCount, campaignFilter, onCampaignFilter, problem, canManage, boardSchema, onChange, onMove, onClose,
}: {
  draft: RuleDraft;
  index: number;
  total: number;
  members: AssignmentMember[];
  campaigns: { id: string; name: string }[];
  allCampaigns: { id: string; name: string }[];
  routerSchema: boolean;
  campaignCount: number;
  campaignFilter: string;
  onCampaignFilter: (value: string) => void;
  problem: string | null;
  canManage: boolean;
  boardSchema: boolean;
  onChange: (next: Partial<RuleDraft>) => void;
  onMove: (delta: number) => void;
  onClose: () => void;
}) {
  const id = `rule-editor-${draft.key}`;
  // One short line under the select; the how lives behind the "?" (2026-10-09 copy pass).
  const note: Record<MatchType, { text: string; tip?: string }> = {
    realtime: { text: "Leads posted in the last N seconds.", tip: "Posted leads already sort first in the queue, so this decides who gets them. With Posted leads › Route on arrival on, it runs the moment they land." },
    language: { text: "Assignees who share the lead's language.", tip: "Only assignees with the lead's language recorded in the capacity table take these leads. If none of them has it, the lead falls through to the next rule." },
    campaign: { text: "Leads bought on these campaigns." },
    product: { text: "Leads for these product codes.", tip: "Licensed only keeps setters off them, here and in every rule after this one." },
    state: { text: "Leads in these states. Licence still decides who in the list may take each one." },
    fallback: { text: "Everything left. Always runs last.", tip: "Spread across the assignees. None ticked is the whole roster." },
  };
  const matchNote = note[draft.matchType];
  return (
    <div id={id} className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-4">
      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <Field
          label="Match"
          htmlFor={`${id}-type`}
          hint={matchNote.tip ? <span className="inline-flex items-center gap-0.5">{matchNote.text}<InfoTip label={`About ${MATCH_LABEL[draft.matchType]} rules`}>{matchNote.tip}</InfoTip></span> : matchNote.text}
        >
          <select id={`${id}-type`} className={control} value={draft.matchType} disabled={!canManage} onChange={(event) => onChange({ matchType: event.target.value as MatchType })}>
            {MATCH_TYPES.map((type) => <option key={type} value={type} disabled={type === "realtime" && !boardSchema && draft.matchType !== "realtime"}>{MATCH_LABEL[type]}</option>)}
          </select>
        </Field>
        <div className="min-w-0">
          {draft.matchType === "realtime" && (
            <Field label="Arrived within (seconds)" htmlFor={`${id}-seconds`} error={problem ?? undefined} hint={!boardSchema ? SCHEMA_PENDING_MESSAGE : undefined}>
              <input id={`${id}-seconds`} className={control} type="number" min={1} max={86400} value={draft.seconds} disabled={!canManage} onChange={(event) => onChange({ seconds: event.target.value })} />
            </Field>
          )}
          {(draft.matchType === "language" || draft.matchType === "product" || draft.matchType === "state") && (
            <Field
              label={draft.matchType === "language" ? "Languages" : draft.matchType === "product" ? "Product codes" : "States"}
              htmlFor={`${id}-values`}
              error={problem ?? undefined}
              hint="Comma-separated."
            >
              <input id={`${id}-values`} className={control} value={draft.listText} disabled={!canManage} onChange={(event) => onChange({ listText: event.target.value })} placeholder={draft.matchType === "language" ? "spanish, english" : draft.matchType === "product" ? "final_expense, term_life" : "TX, NM"} />
            </Field>
          )}
          {draft.matchType === "product" && (
            <label className="mt-2 flex items-center gap-2 text-sm text-[var(--body)]">
              <input type="checkbox" checked={draft.licensedOnly} disabled={!canManage} onChange={(event) => onChange({ licensedOnly: event.target.checked })} />
              Licensed agents only
            </label>
          )}
          {draft.matchType === "campaign" && (
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Campaigns</legend>
              {campaignCount > 8 && <div className="mt-1.5"><ToolbarSearch value={campaignFilter} onChange={onCampaignFilter} placeholder="Find a campaign" label="Find a campaign" /></div>}
              {campaignCount === 0 ? <p className="mt-1.5 text-xs text-[var(--muted)]">No campaigns yet. <Link href="/app/campaigns" className="font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Add one on Vendors &amp; campaigns</Link></p>
 : (
                <div className="mt-2 flex max-h-44 flex-wrap gap-x-4 gap-y-2 overflow-y-auto">
                  {campaigns.map((campaign) => (
                    <label key={campaign.id} className="flex items-center gap-1.5 text-sm text-[var(--body)]">
                      <input type="checkbox" checked={draft.campaignIds.includes(campaign.id)} disabled={!canManage} onChange={(event) => onChange({ campaignIds: event.target.checked ? [...draft.campaignIds, campaign.id] : draft.campaignIds.filter((value) => value !== campaign.id) })} />
                      {campaign.name}
                    </label>
                  ))}
                </div>
              )}
              {problem && <span role="alert" className="mt-1.5 block text-xs text-[var(--error-ink)]">{problem}</span>}
            </fieldset>
          )}
        </div>
      </div>
      {draft.matchType !== "fallback" && (
        <ConditionsEditor
          id={id}
          conditions={draft.conditions}
          campaigns={allCampaigns}
          canManage={canManage}
          routerSchema={routerSchema}
          onChange={(conditions) => onChange({ conditions })}
        />
      )}
      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
        <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Goes to</legend>
        <span className="block text-xs leading-[1.5] text-[var(--muted)]">
          {draft.strategy === "least_loaded" ? "Whoever holds the fewest open leads first; this order breaks ties." : "In this order, round-robin."} None ticked is the whole roster.
        </span>
        <div className="mt-2 max-w-[260px]">
          <label htmlFor={`${id}-strategy`} className="sr-only">How this rule picks</label>
          <select
            id={`${id}-strategy`}
            className={control}
            value={draft.strategy}
            disabled={!canManage || (!routerSchema && draft.strategy === "round_robin")}
            aria-describedby={!routerSchema ? `${id}-strategy-pending` : undefined}
            onChange={(event) => onChange({ strategy: event.target.value as RuleStrategy })}
          >
            {RULE_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{STRATEGY_LABEL[strategy]}</option>)}
          </select>
          {!routerSchema && <span id={`${id}-strategy-pending`} className="mt-1 block text-xs leading-[1.5] text-[var(--muted)]">{SCHEMA_PENDING_MESSAGE}</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {members.map((member) => (
            <label key={member.id} className="flex items-center gap-1.5 text-sm text-[var(--body)]">
              <input type="checkbox" checked={draft.assigneeIds.includes(member.id)} disabled={!canManage} onChange={(event) => onChange({ assigneeIds: event.target.checked ? [...draft.assigneeIds, member.id] : draft.assigneeIds.filter((value) => value !== member.id) })} />
              {member.name} <span className="text-[var(--muted)]">· {roleLabel(member.role)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {canManage && (
        <div className="mt-3 flex flex-wrap justify-end gap-2.5">
          <Button type="button" variant="ghost" size="sm" disabled={draft.matchType === "fallback" || index === 0} title={draft.matchType === "fallback" ? "The fallback always runs last" : undefined} onClick={() => onMove(-1)}>Move up</Button>
          <Button type="button" variant="ghost" size="sm" disabled={draft.matchType === "fallback" || index >= total - 1} title={draft.matchType === "fallback" ? "The fallback always runs last" : undefined} onClick={() => onMove(1)}>Move down</Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}

/** Up to MAX_EXTRA_CONDITIONS more conditions, all of which must match as well as the rule's own. */
export function ConditionsEditor({
  id, conditions, campaigns, canManage, routerSchema, onChange,
}: {
  id: string;
  conditions: ConditionDraft[];
  campaigns: { id: string; name: string }[];
  canManage: boolean;
  routerSchema: boolean;
  onChange: (next: ConditionDraft[]) => void;
}) {
  const update = (key: string, next: Partial<ConditionDraft>) => onChange(conditions.map((condition) => (condition.key === key ? { ...condition, ...next } : condition)));
  const add = () => {
    onChange([...conditions, { key: `${id}-extra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type: "state", listText: "", campaignIds: [], licensedOnly: false }]);
  };
  const full = conditions.length >= MAX_EXTRA_CONDITIONS;
  return (
    <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
      <legend className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">And also</legend>
      <span className="block text-xs leading-[1.5] text-[var(--muted)]">
        Every condition here must match as well, such as a state and a product. Up to {MAX_EXTRA_CONDITIONS + 1} conditions per rule.
      </span>
      {conditions.map((condition, position) => {
        const cid = `${id}-and-${position}`;
        const problem = conditionProblem(condition);
        return (
          <div key={condition.key} className="mt-2 grid gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-[150px_minmax(0,1fr)_auto] md:items-start">
            <div>
              <label htmlFor={`${cid}-type`} className="sr-only">Condition {position + 2} type</label>
              <select id={`${cid}-type`} className={cn(control, "mt-0")} value={condition.type} disabled={!canManage} onChange={(event) => update(condition.key, { type: event.target.value as ConditionType })}>
                {CONDITION_TYPES.map((type) => <option key={type} value={type}>{MATCH_LABEL[type]}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              {condition.type === "campaign" ? (
                campaigns.length === 0 ? <p className="m-0 text-xs text-[var(--muted)]">This workspace has no campaigns yet.</p> : (
                  <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-2 overflow-y-auto" role="group" aria-label={`Condition ${position + 2} campaigns`}>
                    {campaigns.map((campaign) => (
                      <label key={campaign.id} className="flex items-center gap-1.5 text-sm text-[var(--body)]">
                        <input type="checkbox" checked={condition.campaignIds.includes(campaign.id)} disabled={!canManage} onChange={(event) => update(condition.key, { campaignIds: event.target.checked ? [...condition.campaignIds, campaign.id] : condition.campaignIds.filter((value) => value !== campaign.id) })} />
                        {campaign.name}
                      </label>
                    ))}
                  </div>
                )
              ) : (
                <>
                  <label htmlFor={`${cid}-values`} className="sr-only">Condition {position + 2} values</label>
                  <input
                    id={`${cid}-values`}
                    className={cn(control, "mt-0")}
                    value={condition.listText}
                    disabled={!canManage}
                    onChange={(event) => update(condition.key, { listText: event.target.value })}
                    placeholder={condition.type === "language" ? "spanish, es" : condition.type === "product" ? "final_expense" : "TX, NM"}
                  />
                  {condition.type === "product" && (
                    <label className="mt-2 flex items-center gap-2 text-sm text-[var(--body)]">
                      <input type="checkbox" checked={condition.licensedOnly} disabled={!canManage} onChange={(event) => update(condition.key, { licensedOnly: event.target.checked })} />
                      Licensed agents only
                    </label>
                  )}
                </>
              )}
              {problem && <span role="alert" className="mt-1.5 block text-xs text-[var(--error-ink)]">{problem}</span>}
            </div>
            {canManage && (
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove condition ${position + 2}`} onClick={() => onChange(conditions.filter((item) => item.key !== condition.key))}>Remove</Button>
            )}
          </div>
        );
      })}
      {canManage && (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            disabled={full || !routerSchema}
            aria-describedby={`${id}-and-why`}
            onClick={add}
          >
            <PlusIcon />Add an AND condition
          </Button>
          <span id={`${id}-and-why`} className="ml-2 text-xs text-[var(--muted)]">
            {!routerSchema ? SCHEMA_PENDING_MESSAGE : full ? `A rule has at most ${MAX_EXTRA_CONDITIONS + 1} conditions.` : ""}
          </span>
        </div>
      )}
    </fieldset>
  );
}
