/**
 * How a staff search row reads. Pure, and apart from `adminService`, so it can be tested without a
 * database or the app's path aliases.
 */

export type Membership = { role: string | null; tenants: { name: string | null } | null };

/**
 * "Owner · Northline Insurance" — which workspace a person belongs to is what tells two people with
 * the same name apart, and it is what staff are usually looking them up for. Someone in several
 * workspaces shows the first and a count; someone in none falls back to their email.
 */
export function membershipLabel(memberships: Membership[] | null | undefined, email: string | null) {
  const joined = (memberships ?? []).filter((m) => m.tenants?.name);
  if (!joined.length) return [email, "no workspace"].filter(Boolean).join(" · ");
  const [first] = joined;
  const role = first.role ? first.role[0].toUpperCase() + first.role.slice(1) : "Member";
  const more = joined.length > 1 ? ` +${joined.length - 1} more` : "";
  return `${role} · ${first.tenants!.name}${more}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Sep". Spelled out by hand: ICU's en-GB short month is "Sept" on some runtimes and "Sep" on others. */
function shortDate(iso: string) {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "$1,188.00 · paid 14 Sep": the money as money, and the date that goes with the state it is in. */
export function invoiceMeta(row: { status: string; total_cents: number | null; currency: string | null; issued_at: string | null; paid_at: string | null }) {
  const money = row.total_cents === null || row.total_cents === undefined
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: (row.currency ?? "usd").toUpperCase() }).format(row.total_cents / 100);
  // "paid" and "issued" each name their own date; overdue, void and uncollectible say when it was issued.
  const when = row.status === "paid" ? row.paid_at : row.issued_at;
  const date = when ? shortDate(when) : null;
  const ownDate = row.status === "paid" || row.status === "issued";
  const state = ownDate || !date ? [row.status, date].filter(Boolean).join(" ") : `${row.status} · issued ${date}`;
  return [money, state].filter(Boolean).join(" · ");
}
