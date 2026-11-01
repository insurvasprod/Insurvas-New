/**
 * The day as a spreadsheet — the same rows the table shows, in the same order.
 *
 * It lives apart from `service.ts` because that file is `server-only` and therefore cannot be
 * unit-tested, and this is the half most worth testing: a partner reconciles a published statement
 * against this file, so a shifted column or a dropped row is a dispute about money. It is pure, so
 * `csv.test.mjs` can hold it to the rows it was given.
 *
 * Money goes out in units rather than cents, because a spreadsheet will sum this column and
 * `845000` summed is not a number anyone wants. Everything passes through `csvCell`, which guards
 * the leading `=` `+` `-` `@` that would otherwise run as a formula when the file is opened.
 */
import { csvCell } from "../csv/cell.ts";
import type { PartnerDealFlowRow } from "./types.ts";

export const PARTNER_DEAL_FLOW_CSV_HEADER = [
  "Day",
  "Customer",
  "Product",
  "Stage",
  "Carrier",
  "Plan",
  "Monthly premium",
  "Face amount",
  "Draft date",
  "Outcome",
  "Submitted by",
  "Submitted",
  "Updated",
] as const;

function money(cents: number | null): string {
  return typeof cents === "number" ? (cents / 100).toFixed(2) : "";
}

export function partnerDealFlowCsv(rows: readonly PartnerDealFlowRow[]): string {
  const lines = rows.map((row) => [
    row.day,
    row.customer,
    row.productLine,
    row.stageName,
    row.carrier ?? "",
    row.productType ?? "",
    money(row.monthlyPremiumCents),
    money(row.faceAmountCents),
    row.draftDate ?? "",
    row.outcome ?? "",
    row.submittedBy.name,
    row.submittedDay,
    row.updatedAt,
  ].map(csvCell).join(","));
  return [PARTNER_DEAL_FLOW_CSV_HEADER.map(csvCell).join(","), ...lines].join("\n");
}
