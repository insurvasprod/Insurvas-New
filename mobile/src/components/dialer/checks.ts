import { clock, dayKey, stateName } from "@/components/calls/time";
import { codeLabel } from "@/lib/format";

/**
 * Board C7b · the details under the dialer's ticks: every check the server ran for this number, read
 * from GET /api/app/dialer/panel (lib/dialerScripts/service.ts getDialerPanel). Nothing here decides a
 * dial — the server re-runs every check at the click — it only words what the panel already says, the
 * way the web dialer's Compliance details popover does (components/app/dialer/lead-column.tsx).
 */
export type Eligibility = {
  allowed: boolean;
  reason: string;
  message: string;
  checkedAt: string;
  timezone: string | null;
  dncCheck: "pending" | "clear" | "suppressed" | "unavailable";
  suppression?: "clear" | "suppressed" | "unavailable" | "not_checked";
  suppressionHits?: { listType: string; reason: string; addedAt: string | null }[] | null;
  licence?: { status: "live" | "refused" | "unavailable"; state: string; expiresAt: string | null; message: string | null } | null;
  dncExemption?: { basis: string; expiresAt: string | null; certificateUrl: string | null } | null;
};
export type Consent = {
  hasCertificate: boolean; provider: string | null; status: string | null; capturedAt: string | null; consentTimestamp: string | null;
  /** The certificate's first and last four characters ("9a1f…22c0"; 2026-11-27, additive); null when it has no id. */
  certificateRef?: string | null;
};
/**
 * "Not already a client" (GET /api/app/dialer/panel `client`): anyone with this phone, or this date of
 * birth and last name, holding a policy with the agency. Absent from an older server: the row is left out.
 */
export type ClientCheck = { status: "clear" | "client" | "unknown"; basis: "phone" | "date_of_birth" | "lead" | null };
export type CheckPanel = {
  lead: { state: string | null; city?: string | null; attemptsMade?: number; attemptCeiling?: number | null };
  window: { allowed: boolean; startMinute?: number | null; endMinute?: number | null; zone: string | null; reason: string | null } | null;
  eligibility?: Eligibility | null;
  consent?: Consent | null;
  client?: ClientCheck | null;
};

/** ok = passed (green tick), bad = refused or unreadable (red cross), open = not decided here (grey clock). */
export type CheckState = "ok" | "bad" | "open";
export type Check = { key: string; state: CheckState; title: string; detail: string | null };

/** The default ceiling when neither the lead nor its cadence sets one (getDialerPanel: "null → the default seven"). */
export const DEFAULT_ATTEMPT_CEILING = 7;

/** 480 → "8 am", 1290 → "9:30 pm". */
export function minuteLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** 1 → "1st", 3 → "3rd", 12 → "12th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * A time in the customer's zone with the agent's beside it (owner rule): "1:12 pm (2:12 pm yours)".
 * One clock when the two read the same or the customer's zone is unknown.
 */
export function bothClocks(at: Date, customerZone: string | null | undefined, viewerZone: string): string {
  const mine = clock(at, viewerZone);
  if (!customerZone) return mine;
  const theirs = clock(at, customerZone);
  return theirs === mine ? theirs : `${theirs} (${mine} yours)`;
}

/** "today 1:11 pm" / "18 Nov 3:42 pm", in both clocks. */
function whenLabel(iso: string | null | undefined, now: Date, customerZone: string | null, viewerZone: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const day = dayKey(at, viewerZone) === dayKey(now, viewerZone)
    ? "today"
    : new Intl.DateTimeFormat("en-GB", { timeZone: viewerZone, day: "numeric", month: "short" }).format(at);
  return `${day} ${bothClocks(at, customerZone, viewerZone)}`;
}

const LISTS = [
  { key: "federal_dnc", title: () => "National Do Not Call list", dnc: true },
  { key: "state_dnc", title: (state: string | null) => `${stateName(state) ?? "State"} Do Not Call list`, dnc: true },
  { key: "tcpa_litigator", title: () => "Known litigator list", dnc: false },
  { key: "internal", title: () => "Your agency’s do-not-call list", dnc: false },
] as const;

export function complianceChecks(panel: CheckPanel, now: Date, viewerZone: string): Check[] {
  const e = panel.eligibility ?? null;
  const cz = panel.window?.zone ?? e?.timezone ?? null;
  const out: Check[] = [];

  // 1 · consent on file (tenant_consent_artefacts).
  const consent = panel.consent ?? null;
  if (consent?.hasCertificate) {
    out.push({ key: "consent", state: "ok", title: "Written consent", detail: [codeLabel(consent.provider), whenLabel(consent.consentTimestamp ?? consent.capturedAt, now, cz, viewerZone), consent.certificateRef ? `certificate ${consent.certificateRef}` : "certificate on file"].filter(Boolean).join(" · ") });
  } else {
    out.push({ key: "consent", state: "open", title: "Written consent", detail: "No consent certificate on file" });
  }

  // 2 · the stored lists, re-read for this number (tenant_phone_suppression_hits).
  const hits = e?.suppressionHits ?? null;
  const checked = e ? whenLabel(e.checkedAt, now, cz, viewerZone) : null;
  for (const list of LISTS) {
    const title = list.title(panel.lead.state);
    const hit = hits?.find((h) => h.listType === list.key) ?? null;
    if (list.key === "internal") {
      const s = e?.suppression;
      if (hit || s === "suppressed") out.push({ key: list.key, state: "bad", title, detail: "Listed" });
      else if (s === "unavailable") out.push({ key: list.key, state: "bad", title, detail: "Could not be checked" });
      else if (s === "clear") out.push({ key: list.key, state: "ok", title, detail: "Not listed" });
      else out.push({ key: list.key, state: "open", title, detail: s === "not_checked" ? "Not checked · no valid phone" : "Checked when you call" });
      continue;
    }
    if (hit) {
      const exempt = list.dnc && e?.dncExemption ? e.dncExemption : null;
      out.push(exempt
        ? { key: list.key, state: "ok", title, detail: `Listed · cleared by a DNC exemption (${codeLabel(exempt.basis)?.toLowerCase() ?? "on file"})` }
        : { key: list.key, state: "bad", title, detail: "Listed" });
    } else if (hits) {
      out.push({ key: list.key, state: "ok", title, detail: list.dnc && checked ? `Not listed · checked ${checked}` : "Not listed" });
    } else {
      out.push({ key: list.key, state: "open", title, detail: e?.suppression === "not_checked" ? "Not checked · no valid phone" : "Checked when you call" });
    }
  }
  const invalid = hits?.find((h) => h.listType === "invalid");
  if (invalid) out.push({ key: "invalid", state: "bad", title: "Valid number", detail: "On the invalid-number list" });

  // 3 · the calling window (tenant_dial_window, else the eligibility reason).
  const where = panel.lead.city || stateName(panel.lead.state);
  const w = panel.window;
  if (w) {
    const range = w.startMinute != null && w.endMinute != null ? `allowed ${minuteLabel(w.startMinute)} – ${minuteLabel(w.endMinute)}` : null;
    const local = w.zone ? `${bothClocks(now, w.zone, viewerZone)}${where ? ` in ${where}` : ""}` : null;
    out.push({ key: "window", state: w.allowed ? "ok" : "bad", title: "Calling window", detail: [local, range ?? (w.allowed ? null : "closed now")].filter(Boolean).join(" · ") || null });
  } else if (e?.reason === "outside_window") {
    out.push({ key: "window", state: "bad", title: "Calling window", detail: "Closed now" });
  } else {
    out.push({ key: "window", state: "open", title: "Calling window", detail: e?.reason === "no_state" ? "Unknown · the lead has no state" : "Checked when you call" });
  }

  // 4 · the licence the dial is judged on. Not one of the board's rows: it is listed only when it
  // refuses (or could not be read), because then it is why the call will not go through.
  const lic = e?.licence ?? null;
  if (lic && lic.status !== "live") {
    const name = stateName(lic.state) ?? lic.state;
    out.push({ key: "licence", state: "bad", title: `Licensed in ${name}`, detail: lic.status === "refused" ? lic.message ?? `Not licensed in ${name}` : "Could not be checked" });
  }

  // 5 · attempts so far against the cadence's ceiling. The board's "3rd call this week" is not said: attempts_made is
  // the lead's count since it arrived (or was recycled), and the ceiling is on that count, not on a week.
  const made = panel.lead.attemptsMade ?? 0;
  const ceiling = panel.lead.attemptCeiling ?? DEFAULT_ATTEMPT_CEILING;
  out.push({ key: "attempts", state: made < ceiling ? "ok" : "open", title: "Attempts", detail: made < ceiling ? `${ordinal(made + 1)} call · limit ${ceiling}` : `${made} calls · limit ${ceiling} reached` });

  // 6 · not already a client (a policy with the agency on this phone or date of birth).
  const client = panel.client ?? null;
  if (client) {
    out.push(client.status === "clear"
      ? { key: "client", state: "ok", title: "Not already a client", detail: "No policy on phone or date of birth" }
      : client.status === "client"
        ? { key: "client", state: "bad", title: "Not already a client", detail: `Has a policy with your agency · matched on ${client.basis === "phone" ? "phone" : client.basis === "date_of_birth" ? "date of birth" : "this lead"}` }
        : { key: "client", state: "open", title: "Not already a client", detail: "Could not be checked" });
  }

  return out;
}

/**
 * Board C7 · the five ticks on the current lead, folded from the same checks C7b lists, so the card
 * and its Details never disagree. A tick is green only when the check passed; one the server decides
 * at the click says so instead of pretending.
 */
export type Tick = { key: string; label: string; state: CheckState };
export function headTicks(checks: Check[]): Tick[] {
  const by = (key: string) => checks.find((c) => c.key === key) ?? null;
  const fold = (keys: string[]): CheckState | null => {
    const found = keys.map(by).filter((c): c is Check => c !== null);
    if (!found.length) return null;
    if (found.some((c) => c.state === "bad")) return "bad";
    return found.every((c) => c.state === "ok") ? "ok" : "open";
  };
  const out: Tick[] = [];
  const consent = fold(["consent"]);
  if (consent) out.push({ key: "consent", state: consent, label: consent === "ok" ? "Consent" : "No consent on file" });
  const dnc = fold(["federal_dnc", "state_dnc"]);
  if (dnc) out.push({ key: "dnc", state: dnc, label: dnc === "ok" ? "DNC clear" : dnc === "bad" ? "On a DNC list" : "DNC checked at the call" });
  const suppressed = fold(["tcpa_litigator", "internal", "invalid"]);
  if (suppressed) out.push({ key: "suppression", state: suppressed, label: suppressed === "ok" ? "Not suppressed" : suppressed === "bad" ? "Suppressed" : "Lists checked at the call" });
  const window = fold(["window"]);
  if (window) out.push({ key: "window", state: window, label: window === "ok" ? "In window" : window === "bad" ? "Outside the window" : "Window checked at the call" });
  const client = fold(["client"]);
  if (client) out.push({ key: "client", state: client, label: client === "ok" ? "Not a client" : client === "bad" ? "Already a client" : "Client not checked" });
  const licence = fold(["licence"]);
  if (licence === "bad") out.push({ key: "licence", state: "bad", label: "Not licensed here" });
  return out;
}

/**
 * Board C7's chip on the current lead, from the panel's calling window: "Open till 8 pm CT", or when
 * it opens again. Null when the server has not worded a window for this lead.
 */
export function windowChip(window: CheckPanel["window"], zoneShortName: string | null): { tone: "ok" | "warn"; label: string } | null {
  if (!window) return null;
  const tz = zoneShortName ? ` ${zoneShortName}` : "";
  if (window.allowed) return window.endMinute != null ? { tone: "ok", label: `Open till ${minuteLabel(window.endMinute)}${tz}` } : { tone: "ok", label: "Window open" };
  return window.startMinute != null ? { tone: "warn", label: `Opens ${minuteLabel(window.startMinute)}${tz}` } : { tone: "warn", label: "Window closed" };
}
