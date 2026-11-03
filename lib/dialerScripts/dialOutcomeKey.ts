/**
 * Which outcome keys the dialer's disposition route records, and how (pure; no server-only, so a
 * node --test file can pin it).
 *
 * The route accepts its built-in call outcomes (the enum it has always had) OR any ACTIVE outcome in
 * the tenant's `dispositions` table. The format is a short slug either way; the table is checked on
 * the server. Unknown and archived keys are refused with 400.
 *
 * Callbacks: complete_existing_dial_disposition books nothing itself; only `callback_scheduled`
 * reaches recordCallbackDisposition, which books the time in the same transaction. The database
 * constraint dispositions_fixed_next_actions (20260924240200) lets no other key carry the next
 * action "callback", so a custom callback-type outcome cannot exist — and if one ever appeared (a
 * database without that constraint), it is refused here rather than recorded as a callback that
 * schedules nothing.
 */

export const DIAL_OUTCOME_KEY_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const CALLBACK_KEY = "callback_scheduled";

export type DialOutcomeRow = { is_active: boolean; next_action?: string | null } | null;

export type DialOutcomeDecision =
  | { ok: true; path: "callback" | "record" }
  | { ok: false; status: 400; code: "unknown_disposition" | "disposition_archived" | "callback_not_bookable"; error: string };

export function decideDialOutcomeKey(input: { key: string; builtIn: readonly string[]; row: DialOutcomeRow }): DialOutcomeDecision {
  const { key, builtIn, row } = input;
  if (key === CALLBACK_KEY) return { ok: true, path: "callback" };
  if (row && row.next_action === "callback") {
    return { ok: false, status: 400, code: "callback_not_bookable", error: "This outcome is set to book a callback, but on the dialer only Callback books a time. Record Callback instead, or change this outcome's next action in Settings › Dispositions." };
  }
  if (builtIn.includes(key)) return { ok: true, path: "record" };
  if (!row) return { ok: false, status: 400, code: "unknown_disposition", error: "Choose a valid disposition." };
  if (!row.is_active) return { ok: false, status: 400, code: "disposition_archived", error: "That outcome has been archived. Choose another." };
  return { ok: true, path: "record" };
}

/**
 * LA-2.12: a setter books and never sells. Refused for the built-in application outcome by name
 * (as before) and for any outcome the tenant's configuration makes an application — the same test
 * the verification gate uses (applicationOutcomeFor). `isApplication` is null when that could not
 * be read: a setter is then refused, because "may not sell" must not fail open.
 */
export function setterMayRecord(input: { role: string; key: string; isApplication: boolean | null }): boolean {
  if (input.role !== "setter") return true;
  if (input.key === "application_submitted") return false;
  return input.isApplication === false;
}
