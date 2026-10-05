import { z } from "zod";

/** GET /api/app/reports/sales query (LA-3.21). Every filter optional; they compose. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.");
const uuid = z.string().uuid("That filter value is not recognised.");

export const salesReportQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  carrier: uuid.optional(),
  product: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "That product is not recognised.").optional(),
  source: z.string().regex(/^(source:(inbound|outbound|manual)|campaign:[0-9a-f-]{36})$/i, "That lead source is not recognised.").optional(),
  producer: uuid.optional(),
}).strict().refine((q) => !q.from || !q.to || q.from <= q.to, { message: "The start date is after the end date.", path: ["from"] });

export type SalesReportQuery = z.infer<typeof salesReportQuery>;

/** URLSearchParams → the query object, dropping empty values. */
export function queryObject(params: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const [key, value] of params) if (value.trim()) out[key] = value.trim();
  return out;
}
