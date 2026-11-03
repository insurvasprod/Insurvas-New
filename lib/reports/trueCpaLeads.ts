/**
 * The leads behind a True CPA figure (LA-2.17-7), as a page of its own (foundation pass 2026-11-03,
 * docs/reports/FOUNDATION-PASS.md: no side panels). A plain module, so the server page and the client
 * workspace build and read the same address.
 */

/** What a click on a figure opens: the leads behind it, in the report's own scope. */
export type DrillSpec = { key: string; title: string; params: Record<string, string> };

/** The query keys /api/app/true-cpa/leads reads: the report's scope and the figure's stage and cut. */
export const TRUE_CPA_LEAD_KEYS = ["from", "to", "vendor_id", "campaign_id", "product_code", "persist_days", "stage", "slot", "attempt_number"] as const;

export const TRUE_CPA_LEADS_PATH = "/app/true-cpa/leads";

export function trueCpaLeadsHref(spec: DrillSpec, scope: Record<string, string>): string {
  const params = new URLSearchParams({ ...scope, ...spec.params });
  params.set("title", spec.title);
  return `${TRUE_CPA_LEADS_PATH}?${params}`;
}

/** The page's own reading of its address: the scope and cut, and the figure's name (sentence case). */
export function readTrueCpaLeads(query: Record<string, string | string[] | undefined>) {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const params: Record<string, string> = {};
  for (const key of TRUE_CPA_LEAD_KEYS) {
    const value = one(query[key]).slice(0, 80);
    if (value) params[key] = value;
  }
  const raw = one(query.title).slice(0, 160).trim() || "leads behind this figure";
  return { params, title: raw.charAt(0).toUpperCase() + raw.slice(1) };
}
