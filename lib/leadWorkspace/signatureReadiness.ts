/**
 * "Can they finish on this call?" (LeadWorkspace concept board). Six answers the agent records while
 * the customer is on the line; the guidance says what they add up to. Pure, and tested.
 *
 * null = not asked yet, which is never read as "no".
 */

export const SIGNATURE_KEYS = ["can_receive_text", "has_phone_with_them", "can_open_email", "can_stay_on_line", "can_esign_now", "banking_to_hand"] as const;
export type SignatureKey = (typeof SIGNATURE_KEYS)[number];
export type SignatureAnswers = Record<SignatureKey, boolean | null>;

export const SIGNATURE_LABELS: Record<SignatureKey, string> = {
  can_receive_text: "Can receive a text",
  has_phone_with_them: "Has the phone with them",
  can_open_email: "Can open email",
  can_stay_on_line: "Can stay on the line",
  can_esign_now: "Can e-sign now",
  banking_to_hand: "Banking details to hand",
};

export const EMPTY_SIGNATURE: SignatureAnswers = { can_receive_text: null, has_phone_with_them: null, can_open_email: null, can_stay_on_line: null, can_esign_now: null, banking_to_hand: null };

export type SignatureGuidance = { yes: number; asked: number; tone: "success" | "warning" | "error" | "neutral"; headline: string; detail: string };

export function signatureGuidance(answers: SignatureAnswers): SignatureGuidance {
  const values = SIGNATURE_KEYS.map((key) => answers[key]);
  const yes = values.filter((value) => value === true).length;
  const asked = values.filter((value) => value !== null).length;
  const notAsked = SIGNATURE_KEYS.length - asked;
  const no = (key: SignatureKey) => answers[key] === false;

  if (asked === 0) return { yes, asked, tone: "neutral", headline: "Not asked yet", detail: "Ask these while the customer is on the line; together they decide whether the application can be signed today." };
  if (no("can_stay_on_line")) return { yes, asked, tone: "error", headline: "This cannot finish on this call", detail: "They cannot stay on the line. Book a callback for a time they can." };
  // The signature link has to reach the customer somehow, and they have to be able to sign.
  if (no("can_esign_now") && no("can_open_email")) {
    return {
      yes, asked, tone: "error",
      headline: "This cannot be completed on the call",
      detail: answers.can_receive_text === true && answers.has_phone_with_them !== false
        ? "No email and no e-signature right now. Send the link by text, or book a callback once they are at a computer."
        : "No email, no e-signature and no way to receive a link now. Book a callback once they are at a computer.",
    };
  }
  if (no("banking_to_hand")) return { yes, asked, tone: "warning", headline: "Banking is the gap", detail: "Finish everything else now and book a callback for the banking details." };
  if (no("has_phone_with_them") && no("can_open_email")) return { yes, asked, tone: "warning", headline: "The link has nowhere to go yet", detail: "They have no email and not the phone a text would reach. Agree how the link reaches them before you finish." };
  if (yes === SIGNATURE_KEYS.length) return { yes, asked, tone: "success", headline: "They can finish on this call", detail: "Everything needed to sign today is in place." };
  return {
    yes, asked, tone: notAsked ? "neutral" : "success",
    headline: notAsked ? `${notAsked} still to ask` : "Nothing is blocking it",
    detail: notAsked ? "Nothing recorded so far stops them finishing today." : "Some answers are no, but none of them stop them signing today.",
  };
}

export function parseSignatureAnswers(input: unknown): Partial<SignatureAnswers> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Partial<SignatureAnswers> = {};
  for (const key of SIGNATURE_KEYS) {
    if (!(key in input)) continue;
    const value = (input as Record<string, unknown>)[key];
    if (value !== null && typeof value !== "boolean") return null;
    out[key] = value as boolean | null;
  }
  return out;
}
