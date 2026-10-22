import type { Treatment } from "./treatments.ts";

/**
 * The "what to do now" line under a notification that reports a problem (owner, 2026-10-22: "when
 * something went wrong, give a suggestion in the description").
 *
 * Most call sites pass only the server's message as the title (`notify.fail(body.error)`), so the
 * reader learned THAT it failed and nothing about what to do. When the caller gave no `detail`, this
 * reads the title and offers the one next step that usually fixes that kind of problem. A caller
 * that knows better still passes its own `detail`, and that always wins.
 *
 * Pure (no React, no browser) so the wording can be tested. First matching rule wins, so the
 * specific ones sit above the general ones.
 */
const RULES: ReadonlyArray<{ test: RegExp; hint: string }> = [
  { test: /failed to fetch|network|offline|connection|load failed/i, hint: "Check your internet connection, then try again." },
  { test: /timed? ?out|timeout|took too long/i, hint: "It took too long to answer. Wait a moment, then try again." },
  { test: /\b401\b|not authenticated|session (has )?expired|sign in again|log in again/i, hint: "Your session may have ended. Sign in again, then retry." },
  { test: /\b429\b|too many|rate limit|slow down/i, hint: "Too many tries in a row. Wait a minute, then try again." },
  { test: /calling window|outside (the )?(calling )?hours|quiet hours/i, hint: "Wait until the lead's calling hours open, or book a callback." },
  { test: /\bdnc\b|do not call|do-not-call|suppress/i, hint: "This number can't be called. Move on to the next lead." },
  { test: /disclosure/i, hint: "Read and acknowledge the required disclosure first." },
  { test: /licen[cs]e|appointed|appointment/i, hint: "Check States & licences in Settings for this state and carrier." },
  { test: /not entitled|upgrade|your plan|not on your plan|feature/i, hint: "Your plan doesn't include this. See Plan & billing in Settings." },
  { test: /\b403\b|forbidden|not allowed|permission|only the owner|your role/i, hint: "Your role can't do this. Ask the account owner for access." },
  { test: /\b404\b|not found|no longer exists|was removed|deleted/i, hint: "It may have been removed. Refresh the page to see the latest." },
  { test: /\b409\b|already exists|duplicate|conflict|already (in|on|taken)/i, hint: "Something with these details already exists. Look for it before adding again." },
  { test: /seat|limit reached|at (the )?cap|reached (the|your) limit/i, hint: "You've reached your plan's limit. Free one up or upgrade in Plan & billing." },
  { test: /csv|xlsx|excel|pdf|file|upload|attachment/i, hint: "Check the file's type and size, then upload it again." },
  { test: /required|invalid|must be|enter a|choose a|missing|too (long|short)|format/i, hint: "Check the fields on the form, fix the one described, then try again." },
];

const FALLBACK: Partial<Record<Treatment, string>> = {
  fail: "Try again in a moment. If it keeps happening, refresh the page.",
  block: "Fix what's described above, then try again.",
  warn: "Review it before you carry on.",
};

/** Only problems get a suggestion; good news needs none. */
const PROBLEMS: readonly Treatment[] = ["warn", "block", "fail"];

export function suggestionFor(treatment: Treatment, title: string): string | null {
  if (!PROBLEMS.includes(treatment)) return null;
  const rule = RULES.find((candidate) => candidate.test.test(title));
  return rule?.hint ?? FALLBACK[treatment] ?? null;
}

/** The line shown under the title: the caller's own detail, else the suggestion. */
export function detailFor(treatment: Treatment, title: string, detail?: string | null): string | undefined {
  const given = detail?.trim();
  if (given && given !== title.trim()) return given;
  return suggestionFor(treatment, title) ?? undefined;
}
