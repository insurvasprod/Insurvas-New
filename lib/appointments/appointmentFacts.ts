/**
 * Appointments (LA-2 §11) · the facts an appointment row states beside the customer's name.
 *
 * Plain and client-safe (no server-only import), so the calendar, the setters page and node:test
 * all read the same rules. Every value comes from the lead or the appointment; when the lead does
 * not carry a figure, the helper returns null and the screen says nothing rather than a sample.
 */

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  pending: "Awaiting close-out",
  showed: "Shown",
  no_show: "No-show",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

const cents = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * The face amount the lead asked for, in cents. The term-life template stores `coverage_wanted` in
 * cents (a currency field); imported lists carry `face_amount_cents`, or a plain `face_amount` /
 * `coverage_amount` in dollars.
 */
export function faceAmountCents(values: Record<string, unknown> | null | undefined): number | null {
  if (!values) return null;
  const inCents = cents(values.coverage_wanted) ?? cents(values.face_amount_cents) ?? cents(values.coverage_amount_cents);
  if (inCents != null) return inCents;
  const dollars = cents(values.face_amount) ?? cents(values.coverage_amount);
  return dollars == null ? null : dollars * 100;
}

/** "$15k face", "$250k face", "$1.5M face", "$8,500 face". */
export function faceLabel(amountCents: number | null): string | null {
  if (amountCents == null) return null;
  const dollars = amountCents / 100;
  if (dollars >= 1_000_000) return `$${Number((dollars / 1_000_000).toFixed(dollars % 1_000_000 === 0 ? 0 : 1))}M face`;
  if (dollars >= 10_000) return `$${Number((dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1))}k face`;
  return `$${Math.round(dollars).toLocaleString("en-US")} face`;
}

/** "final_expense" → "Final expense". */
export function productLabel(productLine: string | null | undefined): string | null {
  const text = (productLine ?? "").trim().replace(/_/g, " ");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : null;
}

/** "in 24 min", "in 1 h 5 min" — only for an appointment still to come within the next three hours. */
export function startsInLabel(startsAtMs: number, nowMs: number): string | null {
  const minutes = Math.ceil((startsAtMs - nowMs) / 60_000);
  if (minutes <= 0 || minutes > 180) return null;
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

/** "CT" rather than "CDT"/"CST" — the zone a person names, not the season. */
export function zoneAbbreviation(iso: string, zone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value ?? zone;
    return name.replace(/^([CEMP])[SD]T$/, "$1T");
  } catch {
    return zone;
  }
}

/** "12:00 pm their time · CT", or null when the customer's zone is the agent's own. */
export function customerClock(iso: string, customerZone: string | null | undefined, agentZone: string): string | null {
  if (!customerZone || customerZone === agentZone) return null;
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: customerZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).toLowerCase().replace(/ /g, " ");
    return `${time} their time · ${zoneAbbreviation(iso, customerZone)}`;
  } catch {
    return null;
  }
}
