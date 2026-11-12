// What changed between two cadences, in words — for History ("Call 5 waits 2 days (was 1 day)") and
// for the save bar ("call 5 now waits 2 days (was 1 day)"). Pure, shared by client and tests.
//
// Rules are compared by (call, outcome): the shared rule of a call, and each outcome's own rule. A wait
// is compared by length, not spelling, so "24 hours" and "1 day" are the same wait.

import { parseInterval, type CadenceRow } from "./engine.ts";
import { outcomeLabel, preferenceWords } from "./draft.ts";

export type Change = { kind: "add" | "remove" | "change"; text: string };

const key = (row: CadenceRow) => `${row.attemptNumber}|${row.dispositionScope ?? ""}`;
const ms = (value: string) => {
  const parsed = parseInterval(value);
  return parsed.ok ? parsed.ms : NaN;
};

function who(row: CadenceRow) {
  return row.dispositionScope ? `${outcomeLabel(row.dispositionScope)}: call ${row.attemptNumber}` : `Call ${row.attemptNumber}`;
}

/** Every difference from `before` to `after`, calls in order, the shared rule before an outcome's. */
export function describeChanges(before: CadenceRow[], after: CadenceRow[], limits?: { before: number | null; after: number | null }): Change[] {
  const was = new Map(before.map((row) => [key(row), row]));
  const now = new Map(after.map((row) => [key(row), row]));
  const keys = [...new Set([...was.keys(), ...now.keys()])].sort((a, b) => {
    const [an, as] = a.split("|");
    const [bn, bs] = b.split("|");
    return Number(an) - Number(bn) || Number(Boolean(as)) - Number(Boolean(bs)) || as.localeCompare(bs);
  });
  const changes: Change[] = [];
  for (const id of keys) {
    const old = was.get(id);
    const next = now.get(id);
    if (!old && next) {
      changes.push({
        kind: "add",
        text: next.dispositionScope
          ? `${outcomeLabel(next.dispositionScope)} has its own call ${next.attemptNumber}: ${next.delayInterval} after call ${next.attemptNumber - 1}, ${preferenceWords(next.preferredSlot)}`
          : `Added call ${next.attemptNumber}: ${next.delayInterval} after call ${next.attemptNumber - 1}, ${preferenceWords(next.preferredSlot)}`,
      });
      continue;
    }
    if (old && !next) {
      changes.push({ kind: "remove", text: old.dispositionScope ? `${outcomeLabel(old.dispositionScope)} follows the shared call ${old.attemptNumber} again` : `Removed call ${old.attemptNumber}` });
      continue;
    }
    if (!old || !next) continue;
    if (ms(old.delayInterval) !== ms(next.delayInterval)) changes.push({ kind: "change", text: `${who(next)} waits ${next.delayInterval} (was ${old.delayInterval})` });
    if ((old.preferredSlot ?? null) !== (next.preferredSlot ?? null))
      changes.push({ kind: "change", text: `${who(next)} ${preferenceWords(next.preferredSlot)} (was ${preferenceWords(old.preferredSlot)})` });
  }
  if (limits && limits.before !== limits.after) {
    const say = (value: number | null) => (value == null ? "inherited" : String(value));
    changes.push({ kind: "change", text: `Max calls ${say(limits.after)} (was ${say(limits.before)})` });
  }
  return changes;
}

/** Postgres's interval text ("1 day", "02:00:00", "1 day 02:00:00") as the editor's "<n> <unit>". */
export function readableInterval(value: string): string {
  const trimmed = (value ?? "").trim();
  if (parseInterval(trimmed).ok) return trimmed;
  const days = /^(\d+)\s+days?(?:\s+00:00:00)?$/i.exec(trimmed);
  if (days) return `${days[1]} ${days[1] === "1" ? "day" : "days"}`;
  const clock = /^(?:(\d+)\s+days?\s+)?(\d{2}):(\d{2}):(\d{2})$/i.exec(trimmed);
  if (!clock) return trimmed;
  const minutes = Number(clock[1] ?? 0) * 1440 + Number(clock[2]) * 60 + Number(clock[3]);
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
