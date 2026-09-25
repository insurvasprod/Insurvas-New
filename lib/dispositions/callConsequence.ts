/**
 * What the DIALER does with an outcome recorded against a call — the call-mode wording of the
 * "Record call outcome" dialog. Mirrors `complete_existing_dial_disposition` (latest definition,
 * 20260924240200) branch for branch, from the same inputs it reads:
 *
 *   do_not_call            suppress_phone(internal) + closed
 *   callback_scheduled     a callback is booked (recordCallbackDisposition), lead 'working'
 *   ends_call + rest + N   lead 'nurture' for N minutes, then served again
 *   ends_call              closed (wrong_number / disconnected are also flagged for a vendor credit)
 *   otherwise              schedule_next_attempt: a retry (a fixed delay when next_action is retry),
 *                          or 'exhausted' once the attempt ceiling is reached
 *   terminal states        routed to the stage mapped for the key (stage_dispositions), any pipeline
 *   'retry'                never moves stage
 *
 * Every one of them closes the attempt and counts toward the lead's attempts.
 *
 * Plain module (no server-only): the dialer route builds the lines, a node --test file pins them.
 * Self-contained (type imports only) so node --test can load it without a bundler; the two keys the
 * SQL branches on first are the same constants nextAction.ts exports.
 */

import type { NextActionSetting } from "./nextAction";

const DO_NOT_CALL_KEY = "do_not_call";
const CALLBACK_KEY = "callback_scheduled";

function splitMinutes(minutes: number): { value: number; unit: "minutes" | "hours" | "days" } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export type CallOutcomeConfig = {
  disposition_key: string;
  /** coalesce(dispositions.ends_call, disposition_default_ends_call(key)), as the SQL reads it. */
  ends_call: boolean;
  /** The stored next action, or the one derived for a row without it. Null for "none stored". */
  next: NextActionSetting | null;
  /** The live stage stage_dispositions maps this key to, if any. */
  mapped_stage: { name: string; pipeline_name: string } | null;
  needs_verification?: boolean;
};

export type CallConsequence = {
  /** What the dialer will do, in the SQL's terms. */
  effect: "suppress" | "callback" | "rest" | "close" | "retry" | "cadence";
  /** The 12px line under the option. */
  line: string;
  /** The "Next action preview" sentence. */
  preview: string;
  /** Whether recording it moves the lead to the mapped stage (terminal outcomes only). */
  movesStage: boolean;
};

/** "20 minutes", "2 hours", "90 days". */
export function durationWords(minutes: number): string {
  const { value, unit } = splitMinutes(minutes);
  return `${value} ${value === 1 ? unit.slice(0, -1) : unit}`;
}

const CREDIT_FLAGGED = new Set(["wrong_number", "disconnected"]);

export function dialConsequence(config: CallOutcomeConfig): CallConsequence {
  const key = config.disposition_key;
  const stage = config.mapped_stage;
  const minutes = config.next?.minutes ?? null;
  let effect: CallConsequence["effect"];
  if (key === DO_NOT_CALL_KEY) effect = "suppress";
  else if (key === CALLBACK_KEY) effect = "callback";
  else if (config.ends_call && config.next?.kind === "rest" && minutes) effect = "rest";
  else if (config.ends_call) effect = "close";
  else if (config.next?.kind === "retry" && minutes) effect = "retry";
  else effect = "cadence";

  const terminal = effect !== "retry" && effect !== "cadence";
  const where = stage ? `moves the lead to ${stage.name} in ${stage.pipeline_name}` : "the lead stays in its stage";
  const exhaustedWhere = stage ? `, and it moves to ${stage.name}` : "";

  let head: string;
  switch (effect) {
    case "suppress":
      head = "Adds the number to your do-not-call list permanently and closes the lead";
      break;
    case "callback":
      head = "Books a callback at the time you choose; the cadence stops until then";
      break;
    case "rest":
      head = `Rests the lead for ${durationWords(minutes ?? 0)}, then serves it again as nurture`;
      break;
    case "close":
      head = CREDIT_FLAGGED.has(key) ? "Closes the lead and flags it for a vendor credit claim" : "Closes the lead; no further attempts";
      break;
    case "retry":
      head = `Back in the queue in ${durationWords(minutes ?? 0)}; at the attempt ceiling it is exhausted instead${exhaustedWhere}`;
      break;
    default:
      head = `Next attempt on your cadence; at the attempt ceiling it is exhausted instead${exhaustedWhere}`;
  }
  const line = [terminal ? `${head} · ${where}` : head, config.needs_verification ? "needs verification complete" : null].filter(Boolean).join(" · ");
  const stageSentence = terminal
    ? stage ? ` The lead moves to ${stage.name} in ${stage.pipeline_name}.` : " No stage is mapped to this outcome, so the lead stays in its stage."
    : " A retry never moves the lead's stage.";
  const preview = `${head}.${stageSentence} The call attempt is closed and counts toward the lead's attempts.`;
  return { effect, line, preview, movesStage: terminal && Boolean(stage) };
}
