export type DncScrubDecision = {
  allowed: boolean;
};

/**
 * The vendor registry deliberately accepts a small adapter-neutral response contract. A vendor
 * adapter can answer with `allowed`, `listed`, or `is_dnc`; anything else fails closed so a
 * vendor returning an unexpected payload can never accidentally permit a dial.
 */
export function parseDncScrubDecision(payload: unknown): DncScrubDecision {
  const value = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(value)) throw new Error("DNC vendor returned an invalid response");
  if (typeof value.allowed === "boolean") return { allowed: value.allowed };
  if (typeof value.listed === "boolean") return { allowed: !value.listed };
  if (typeof value.is_dnc === "boolean") return { allowed: !value.is_dnc };
  throw new Error("DNC vendor response did not include an allow or listing decision");
}

/** Accept common display formats but send vendors digits only, preserving a leading country code. */
export function normalizeDialPhone(value: string): string {
  const input = value.trim();
  if (!/^[+()\d\s.-]+$/.test(input)) throw new Error("Enter a valid phone number");
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("Enter a valid phone number");
  return input.startsWith("+") ? `+${digits}` : digits;
}

export function maskDialPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `••••${digits.slice(-4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
