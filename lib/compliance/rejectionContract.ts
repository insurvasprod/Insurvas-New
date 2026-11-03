export const TCPA_REJECTION_REASON = "tcpa_block" as const;
export const NEUTRAL_END_CALL_SCRIPT =
  "I’m sorry, but I cannot continue this call today. Thank you for your time, and take care.";

export function maskLastFour(phoneDigits: string | null | undefined): string | null {
  return phoneDigits && /^\d{10}$/.test(phoneDigits) ? `••••${phoneDigits.slice(-4)}` : null;
}
