/**
 * Setup › Pipeline rules · the checks, one function for a preview and for a run (the friend's safety
 * rules, docs/la4/SIMPLIFY-PROPOSAL.md §4). For every rule that is on (forecast or live) and every event
 * it listens for, in this order:
 *
 *   1. once only        the change was already recorded for this rule, version and mode → left out
 *   2. live from now    a live rule acts on what happened since it went live (or since its version), unless
 *                       a person asked to move the cards that qualify now
 *   3. a lead           no lead linked to the policy yet → waits (not recorded, so a late link runs it once)
 *   4. the board        the rule's stage is gone from the board → skipped
 *   5. already there    the card is already in the rule's stage → skipped
 *   6. from-stage       the card is not in a stage the rule moves from → skipped
 *   7. by hand          a person moved the card in the last N days (7) → skipped
 *   8. another policy   the lead has another open policy → skipped
 *   9. disagree         two rules want one card in different places → held, for a person (Needs you)
 *  10. the cap          more moves than the cap (25) in one run → the rest stop, not recorded, for a person to look
 *
 * Forecast and live are counted apart: a forecast "would move" never stops a live move, and the cap
 * applies to each. Pure; relative imports only.
 */
import { fillNote, type RuleEvent, type RuleMode } from "./rules.ts";
import { policyKey, type RuleEventFact } from "./events.ts";

export type RuleSpec = {
  ruleId: string;
  name: string;
  mode: RuleMode;
  enabled: boolean;
  versionId: string;
  version: number;
  event: RuleEvent;
  carrierIds: string[];
  fromStageIds: string[];
  targetPipelineId: string;
  targetStageId: string;
  noteOn: boolean;
  noteTemplate: string | null;
  /** A live rule acts on events on or after this day (the later of going live and its version). Null: no cut-off. */
  since: string | null;
};

export type LeadState = {
  leadId: string;
  pipelineId: string | null;
  stageId: string | null;
  /** The last time a person moved the card (board, list, lead page, dialer…), ISO. */
  lastHandMoveAt: string | null;
  /** The lead's other policies still open, as "carrier|number" keys (this one excluded by the planner). */
  openPolicies: string[];
};

export type StageInfo = { id: string; name: string; pipelineId: string; pipelineName: string; archived: boolean };

export type Outcome = "move" | "skip" | "hold" | "wait" | "capped";

export type Decision = {
  ruleId: string;
  ruleName: string;
  versionId: string;
  version: number;
  /** A draft previewed counts as forecast. */
  mode: "forecast" | "live";
  outcome: Outcome;
  reason: string;
  event: RuleEvent;
  eventDate: string;
  changeKey: string;
  carrierId: string;
  policyNumber: string;
  leadId: string | null;
  fromPipelineId: string | null;
  fromStageId: string | null;
  toPipelineId: string;
  toStageId: string;
  note: string | null;
  because: string;
  fills: RuleEventFact["fills"];
};

export type PlanInput = {
  /** Now, ISO (the hand-move window counts back from it). */
  now: string;
  rules: RuleSpec[];
  events: RuleEventFact[];
  /** "carrier|number" → the lead the policy is linked to, or null. */
  leads: Map<string, LeadState | null>;
  stages: Map<string, StageInfo>;
  /** `${ruleId}|${version}|${mode}|${changeKey}` already recorded. */
  done: Set<string>;
  cap: number;
  handMoveDays: number;
  /** Rules whose cut-off is ignored this time: Switch to live with "Also move the cards that qualify now". */
  replay?: Set<string>;
  /** Preview: this rule is planned even as a draft or switched off (it counts as forecast unless live). */
  previewRuleId?: string;
};

export type Plan = { decisions: Decision[]; capped: { forecast: number; live: number } };

export const doneKey = (ruleId: string, version: number, mode: string, changeKey: string) => `${ruleId}|${version}|${mode}|${changeKey}`;

const DAY = 86_400_000;
const stageLabel = (stages: Map<string, StageInfo>, id: string | null) => {
  if (!id) return "no stage";
  const s = stages.get(id);
  return s ? `${s.pipelineName} › ${s.name}` : "a stage not on the board";
};

export function planRun(input: PlanInput): Plan {
  const handCutoff = new Date(Date.parse(input.now) - input.handMoveDays * DAY).toISOString();
  const passing: Decision[] = [];
  const decisions: Decision[] = [];

  for (const rule of input.rules) {
    if (rule.ruleId !== input.previewRuleId && (!rule.enabled || rule.mode === "draft")) continue;
    const mode: "forecast" | "live" = rule.mode === "live" ? "live" : "forecast";
    for (const event of input.events) {
      if (event.event !== rule.event) continue;
      if (rule.carrierIds.length && !rule.carrierIds.includes(event.carrierId)) continue;
      if (input.done.has(doneKey(rule.ruleId, rule.version, mode, event.changeKey))) continue;
      if (mode === "live" && rule.since && event.date < rule.since && !input.replay?.has(rule.ruleId)) continue;

      const lead = input.leads.get(policyKey(event.carrierId, event.policyNumber)) ?? null;
      const base: Decision = {
        ruleId: rule.ruleId, ruleName: rule.name, versionId: rule.versionId, version: rule.version, mode,
        outcome: "skip", reason: "", event: rule.event, eventDate: event.date, changeKey: event.changeKey,
        carrierId: event.carrierId, policyNumber: event.policyNumber, leadId: lead?.leadId ?? null,
        fromPipelineId: lead?.pipelineId ?? null, fromStageId: lead?.stageId ?? null,
        toPipelineId: rule.targetPipelineId, toStageId: rule.targetStageId, note: null, because: event.because, fills: event.fills,
      };
      const target = input.stages.get(rule.targetStageId);
      const skip = (reason: string, outcome: Outcome = "skip") => decisions.push({ ...base, outcome, reason });

      if (!lead) { skip("No lead is linked to this policy yet; it runs once the policy is linked", "wait"); continue; }
      if (!target || target.archived || target.pipelineId !== rule.targetPipelineId) { skip("The rule's stage is no longer on the board"); continue; }
      if (lead.stageId === rule.targetStageId) { skip(`Already in ${stageLabel(input.stages, rule.targetStageId)}`); continue; }
      if (rule.fromStageIds.length && (!lead.stageId || !rule.fromStageIds.includes(lead.stageId))) { skip(`In ${stageLabel(input.stages, lead.stageId)}, not a stage this rule moves from`); continue; }
      if (lead.lastHandMoveAt && lead.lastHandMoveAt >= handCutoff) { skip(`Moved by hand on ${lead.lastHandMoveAt.slice(0, 10)}`); continue; }
      const others = lead.openPolicies.filter((key) => key !== policyKey(event.carrierId, event.policyNumber));
      if (others.length) { skip(`The lead has another open policy (${others.map((key) => key.split("|")[1]).join(", ")})`); continue; }

      passing.push({ ...base, outcome: "move", reason: `${stageLabel(input.stages, lead.stageId)} → ${stageLabel(input.stages, rule.targetStageId)}`, note: rule.noteOn && rule.noteTemplate ? fillNote(rule.noteTemplate, event.fills) : null });
    }
  }

  // Two rules, one card, different places: hold them all for a person. The same place: one move.
  const byCard = new Map<string, Decision[]>();
  for (const d of passing) {
    const card = `${d.mode}|${d.leadId}`;
    byCard.set(card, [...(byCard.get(card) ?? []), d]);
  }
  const moves: Decision[] = [];
  for (const group of byCard.values()) {
    const targets = new Set(group.map((d) => d.toStageId));
    if (targets.size > 1) {
      const said = group.map((d) => `${d.ruleName} → ${stageLabel(input.stages, d.toStageId)}`).join("; ");
      for (const d of group) decisions.push({ ...d, outcome: "hold", reason: `Rules disagree: ${said}` });
      continue;
    }
    group.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.ruleName.localeCompare(b.ruleName));
    moves.push(group[0]);
    for (const d of group.slice(1)) decisions.push({ ...d, outcome: "skip", reason: `${group[0].ruleName} moves it to the same stage` });
  }

  // The cap, per mode, oldest first.
  moves.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.changeKey.localeCompare(b.changeKey));
  const used = { forecast: 0, live: 0 };
  const capped = { forecast: 0, live: 0 };
  for (const d of moves) {
    if (used[d.mode] >= input.cap) {
      capped[d.mode] += 1;
      decisions.push({ ...d, outcome: "capped", reason: `Stopped at the run cap of ${input.cap}; it moves after a person looks, or in the next run` });
      continue;
    }
    used[d.mode] += 1;
    decisions.push(d);
  }
  return { decisions, capped };
}

/** The outcomes recorded (once only); a wait and a cap stop are not, so they come back. */
export const RECORDED: ReadonlySet<Outcome> = new Set(["move", "skip", "hold"]);

export type OutcomeCounts = Record<Outcome, number>;
export function countOutcomes(decisions: Decision[]): OutcomeCounts {
  const counts: OutcomeCounts = { move: 0, skip: 0, hold: 0, wait: 0, capped: 0 };
  for (const d of decisions) counts[d.outcome] += 1;
  return counts;
}
