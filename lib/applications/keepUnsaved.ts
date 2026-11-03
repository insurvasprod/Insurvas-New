// The workspace's re-read of a case, with what is on screen but not yet saved laid over it (LA-3).
// Pure and client-safe: the workspace context calls it, the tests import it.
//
// Why: a save that re-reads the case (an answer that brings up a disclosure, a selected quote) used
// to replace the whole screen with the server's copy. An answer given while that save was in flight
// was wiped, and the next save then sent it as a hidden follow-up and deleted it on the server.

import type { InsuredRole } from "./constants.ts";
import type { CaseView, InterviewView } from "./types.ts";

/** A value still on its way to the server: `attemptId|fieldKey`. */
export const unsavedValueMark = (attemptId: string, fieldKey: string) => `${attemptId}|${fieldKey}`;
/** Interview answers or medications still on their way: `interviewId|answers` / `interviewId|medications`. */
export const unsavedInterviewMark = (interviewId: string, part: "answers" | "medications") => `${interviewId}|${part}`;

export function keepUnsaved(prev: CaseView, next: CaseView, values: ReadonlySet<string>, interview: ReadonlySet<string>): CaseView {
  if (!values.size && !interview.size) return next;
  const attempts = next.attempts.map((a) => {
    const before = prev.attempts.find((p) => p.id === a.id);
    if (!before) return a;
    const keys = Object.keys(before.values).filter((k) => values.has(unsavedValueMark(a.id, k)));
    return keys.length ? { ...a, values: { ...a.values, ...Object.fromEntries(keys.map((k) => [k, before.values[k]])) } } : a;
  });
  const interviews: CaseView["interviews"] = { ...next.interviews };
  for (const [role, iv] of Object.entries(next.interviews) as [InsuredRole, InterviewView | undefined][]) {
    const before = prev.interviews[role];
    if (!iv || !before || before.id !== iv.id) continue;
    interviews[role] = {
      ...iv,
      answers: interview.has(unsavedInterviewMark(iv.id, "answers")) ? before.answers : iv.answers,
      medications: interview.has(unsavedInterviewMark(iv.id, "medications")) ? before.medications : iv.medications,
    };
  }
  return { ...next, attempts, interviews };
}
