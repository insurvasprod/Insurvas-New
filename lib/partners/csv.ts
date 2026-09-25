import type { PartnerRow } from "./service";

/**
 * A CSV cell.
 *
 * The leading-quote guard is the same one `lib/contacts/csv.ts` uses and is not cosmetic: a value
 * beginning `=`, `+`, `-` or `@` is executed as a formula when the file is opened in a spreadsheet,
 * and partner names are attacker-influenced text that reaches a finance team's Excel.
 */
function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function money(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function percent(basisPoints: number | null) {
  return basisPoints === null ? "" : (basisPoints / 100).toFixed(2);
}

/**
 * The partner directory as a CSV.
 *
 * Deliberately the same columns the directory shows, plus the active commercial term. It carries no
 * partner-user personal data — the route that produces it is gated on `publisher_records`, which
 * owners and bookkeepers hold, and a partner's team roster is a different question with a different
 * screen.
 */
export function csvForPartners(partners: PartnerRow[]) {
  const headers = [
    "name",
    "partner_type",
    "status",
    "country",
    "timezone",
    "contact_name",
    "contact_email",
    "active_user_count",
    "lead_volume_this_month",
    "last_submission",
    "payout_model",
    "rate",
    "rate_pct",
    "created_at",
  ];

  const lines = [headers.map(csvCell).join(",")];
  for (const partner of partners) {
    const term = partner.active_term;
    lines.push(
      [
        partner.name,
        partner.partner_type,
        partner.status,
        partner.country,
        partner.timezone,
        partner.contact_name ?? "",
        partner.contact_email ?? "",
        partner.active_user_count,
        partner.lead_volume_this_month,
        partner.last_submission ?? "",
        term?.payout_model ?? "",
        money(term?.rate_cents ?? null),
        percent(term?.rate_pct_bp ?? null),
        partner.created_at,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
