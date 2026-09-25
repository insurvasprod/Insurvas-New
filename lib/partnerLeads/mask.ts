/**
 * What a partner may not read back out of their own submission.
 *
 * LA-1.17 lists this under "What the partner must NOT see" and calls the list the task itself —
 * *"Get it wrong and the platform leaks."* The entry that is easy to miss is the last one, and the
 * ticket says why:
 *
 *   "Full SSN, banking details and policy numbers — masked, **even though their own closer typed
 *    them**. A closer typing a routing number into a form is not the same as every user at that
 *    partner being able to browse it afterwards."
 *
 * So this is not about trust in the partner. It is about the difference between one person entering
 * a value during a call and everyone at that company reading it for the rest of time.
 *
 * ## Why this lives in its own module
 *
 * It was a regex and a closure inside `service.ts`, which is `server-only` and therefore cannot be
 * unit-tested. The only coverage was a live check that the one sensitive field in today's templates
 * comes back masked. That is worth having and it cannot answer the question that matters: whether
 * the pattern still covers a field nobody has added yet.
 *
 * ## The gap that widened it
 *
 * Checked against every template field in the live project on 2026-09-22: **11 distinct keys, of
 * which exactly one (`ssn`) is sensitive.** No template has a banking field at all, so the banking
 * half of this pattern has never been exercised by real data — it is pre-emptive, which is correct
 * for a leak this expensive.
 *
 * Being pre-emptive, it has to match the names the product itself will use. LA-1.4 specifies the
 * form's Banking section as **"institution, routing number, account number"**. `routing` and
 * `account_number` matched; a field keyed `institution` did not, and `bank` only catches it when
 * someone happens to write `bank_institution`. `iban` and `swift` are the same shape of miss for an
 * international carrier. All three are added here.
 *
 * Over-masking has a cost too — a partner who cannot see a field they need is a regression — so this
 * stays limited to the three categories the ticket names: SSN, banking details, policy numbers.
 * Notably it does **not** include date of birth, which is a normal lead field the partner's own
 * closer collected and legitimately reviews.
 */
export const SENSITIVE_PARTNER_KEY =
  /(ssn|social.?security|routing|bank|account.?number|institution|iban|swift|policy.?number|policy_no|credit.?card)/i;

export const MASKED_PLACEHOLDER = "[Masked]";

/**
 * Recursively replaces sensitive values by KEY, not by shape.
 *
 * Keyed on the field name rather than the value because a routing number and a quoted premium are
 * both nine-ish digits, and guessing from the value would either leak or mask the wrong thing.
 * Arrays inherit their parent's key so a repeated banking section masks every entry.
 */
export function maskSensitiveValues(value: unknown, key = ""): unknown {
  if (SENSITIVE_PARTNER_KEY.test(key)) return MASKED_PLACEHOLDER;
  if (Array.isArray(value)) return value.map((item) => maskSensitiveValues(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        maskSensitiveValues(childValue, childKey),
      ]),
    );
  }
  return value;
}
