// Whether a value on the application's Verify step ("Who you are talking to") is already confirmed.
// Pure and client-safe, so the step and its test read the same rule.
//
// LA-2.14 (verify once): what the agent marked "It's right" in the call's Verification phase carries
// into this step, field by field, so the caller is not asked twice. The address is the one exception
// to "the call was verified, so everything is": a state, a ZIP or a city is not an address, so the
// address counts as confirmed on the call only when the street (addr.line1) itself was confirmed there.
//
// The confirmations are read from the lead's latest verification session (lib/applications/service.ts),
// not only the one of the work item that first opened the case: a case is reused for the lead's next
// call, and that call's Verification is the one the agent just did.

export type ConfirmValue = { value?: unknown; hasValue?: boolean; reviewed?: boolean } | undefined;

export type ConfirmItem = { key: string; shown: string; keys: string[] };

export type ConfirmVerification = { complete?: boolean; confirmedKeys?: string[] } | null | undefined;

/** The Verify step's address item: confirmed on the call only with its street. */
export const ADDRESS_ITEM_KEY = "addr.line1";

const has = (f: ConfirmValue) => Boolean(f && (f.hasValue || (f.value !== null && f.value !== undefined && f.value !== "")));

/**
 * Where the confirmation came from: "call" (the call's Verification phase), "here" (checked on this
 * step or the Application step), or null while it is still to be asked.
 */
export function confirmationOf(item: ConfirmItem, values: Record<string, ConfirmValue>, verification: ConfirmVerification): "call" | "here" | null {
  if (!item.shown) return null;
  const present = item.keys.filter((k) => has(values[k]));
  const onCall = new Set(verification?.confirmedKeys ?? []);
  const isAddress = item.key === ADDRESS_ITEM_KEY;
  if (isAddress) {
    // The street must be on the application and confirmed on the call (a lead form's one "address"
    // field is the street line); the state, city or ZIP confirmed alone is not enough.
    if (has(values["addr.line1"]) && onCall.has("addr.line1")) return "call";
  } else {
    if (present.length > 0 && present.every((k) => onCall.has(k))) return "call";
    // A finished verification covers the identity values it was built to check, whatever the lead
    // form named them — never the address (above).
    if (verification?.complete) return "call";
  }
  if (present.length > 0 && present.every((k) => values[k]!.reviewed)) return "here";
  return null;
}
