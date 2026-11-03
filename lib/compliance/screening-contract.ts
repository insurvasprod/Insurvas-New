import type { Json } from "@/lib/supabase/database.types";

export type ScreeningVendorType = "dnc_scrub" | "litigator_scrub";
export type TypedScreeningResponse = { listed: boolean; rawResponse: { [key: string]: Json } };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The only vendor answer accepted by LA-1.5. It deliberately checks named boolean fields at the
 * root (or one `data` envelope) and never interprets prose, nested records, or a truthy string.
 */
export function parseTypedScreeningResponse(payload: unknown, vendorType: ScreeningVendorType): TypedScreeningResponse {
  if (!isObject(payload)) throw new Error("Vendor returned an invalid JSON object");
  const rawResponse = payload as { [key: string]: Json };
  const value = isObject(rawResponse.data) ? rawResponse.data : rawResponse;
  const candidates = vendorType === "dnc_scrub"
    ? [value.allowed, typeof value.listed === "boolean" ? !value.listed : undefined, typeof value.is_dnc === "boolean" ? !value.is_dnc : undefined]
    : [value.hit, value.is_litigator, value.listed];
  const selected = candidates.find((item) => typeof item === "boolean");
  if (typeof selected !== "boolean") throw new Error("Vendor response did not include a typed screening decision");
  return { listed: vendorType === "dnc_scrub" ? !selected : selected, rawResponse };
}
