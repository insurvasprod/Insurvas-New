import type { IconName } from "@/components/icon";
import { addDays, clock, dayKey, dayLabel, weekday } from "@/components/calls/time";
import { displayName } from "@/lib/format";
import type { Tone } from "@/theme/tokens";

/**
 * Cases and deal flow (board E5, E6, E6b, E7): the answers of the web's own routes, and the pure rules
 * that turn them into rows. Kept apart from the screens so the sorting and wording are tested once.
 *
 *   GET /api/app/pending                         open requirements, counteroffers (lib/applications/pending.ts)
 *   GET /api/app/applications                    every attempt, for At carrier and Issued (lib/applications/lists.ts)
 *   GET /api/app/applications/cases/:id          one case, every attempt (lib/applications/service.ts getCaseView)
 *   GET /api/app/applications/cases/:id/timeline what happened, newest first
 *   GET /api/app/deal-flow?from=&to=             the day's deals and their figures (lib/dealFlow/service.ts)
 */

// ─── answers ─────────────────────────────────────────────────────────────────────────────────────
export type RequirementKind = "aps" | "phone_interview" | "voice_verification" | "missing_info" | "amendment" | "paramed_exam" | "counteroffer" | "other";
export type WaitingOn = "client" | "carrier" | "agent" | "third_party";
export type ApplicationStatus = "draft" | "ready" | "submitted" | "pending_carrier" | "counteroffer_pending" | "closed";

export type PendingRequirement = {
  id: string; applicationId: string; caseId: string; clientName: string; carrierName: string | null;
  kind: RequirementKind; description: string; waitingOn: WaitingOn; status: "open" | "in_progress" | "satisfied" | "waived" | "expired";
  raisedAt: string; dueAt: string | null; daysOpen: number; ageing: "ok" | "amber" | "red";
};
export type PendingCounteroffer = { id: string; applicationId?: string; caseId: string; clientName: string; carrierName: string | null; expiresAt: string | null; status: string };
export type PendingAnswer = { requirements: PendingRequirement[]; counteroffers: PendingCounteroffer[] };

export type ApplicationRow = {
  caseId: string; applicationId: string; leadId: string; clientName: string; carrierName: string | null; productLabel: string | null;
  status: ApplicationStatus; outcome: string | null; submittedAt?: string | null; closedAt?: string | null; updatedAt: string;
};
export type ApplicationsAnswer = { applications: ApplicationRow[] };

export type CaseRequirement = {
  id: string; applicationId: string; kind: RequirementKind; description: string; waitingOn: WaitingOn;
  status: "open" | "in_progress" | "satisfied" | "waived" | "expired"; raisedAt: string; dueAt: string | null;
};
export type CaseQuote = { id: string; carrierName: string; productLabel: string; faceAmountCents: number; monthlyPremiumCents: number; status: string };
export type CaseAttempt = {
  id: string; attemptNo: number; status: ApplicationStatus; outcome: string | null; carrierName: string | null; productLabel: string | null;
  selectedQuoteId: string | null; quotes: CaseQuote[]; requirements: CaseRequirement[];
  counteroffers: { id: string; reason: string; expiresAt: string; status: string }[];
  submissions: { id: string; carrierReference: string | null; policyNumber: string | null; submittedAt: string }[];
  payment: { draftDay: number | null } | null;
  welcomePack: { status: string } | null;
};
export type CaseView = { caseId: string; leadId: string; clientName: string; clientPhone: string | null; attempts: CaseAttempt[] };
export type CaseEvent = { id: string; at: string; title: string; by: string | null; detail: string | null; attemptNo: number | null };

// ─── money (owner rule: whole dollars, never cents) ──────────────────────────────────────────────
export function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

// ─── E5 · Pending cases ──────────────────────────────────────────────────────────────────────────
export type CaseRowModel = { key: string; caseId: string; requirementId?: string; title: string; meta: string; icon: IconName; tone: Tone; chip: string };

/** What the person does about each kind of requirement, in the board's words ("Needs a doc"). */
const NEED: Record<RequirementKind, { chip: string; icon: IconName; noun: string }> = {
  aps: { chip: "Needs a doc", icon: "fileCheck", noun: "doctor’s records (APS)" },
  missing_info: { chip: "Needs info", icon: "fileCheck", noun: "missing information" },
  amendment: { chip: "Sign again", icon: "pencil", noun: "signature missing" },
  voice_verification: { chip: "Verify voice", icon: "mic", noun: "voice verification" },
  phone_interview: { chip: "Book interview", icon: "phone", noun: "phone interview not done" },
  paramed_exam: { chip: "Book exam", icon: "calCheck", noun: "paramedical exam" },
  counteroffer: { chip: "Counteroffer", icon: "scale", noun: "counteroffer" },
  other: { chip: "Needs you", icon: "fileCheck", noun: "carrier request" },
};

/** The short name of a requirement, as the case card titles it. */
export const KIND_TITLE: Record<RequirementKind, string> = {
  aps: "Doctor’s records (APS)", missing_info: "Missing information", amendment: "Amendment", voice_verification: "Voice verification",
  phone_interview: "Phone interview", paramed_exam: "Paramedical exam", counteroffer: "Counteroffer", other: "Carrier request",
};

export function needOf(kind: RequirementKind) { return NEED[kind] ?? NEED.other; }

/** A requirement a phone camera can answer: a page the carrier wants to see. */
export function takesDocument(kind: RequirementKind): boolean {
  return kind === "aps" || kind === "missing_info" || kind === "amendment" || kind === "other";
}

const OPEN = new Set(["open", "in_progress"]);
const AT_CARRIER = new Set<ApplicationStatus>(["submitted", "pending_carrier", "counteroffer_pending"]);
const CARRIER_STATUS: Partial<Record<ApplicationStatus, string>> = { submitted: "Submitted", pending_carrier: "Pending carrier", counteroffer_pending: "Counteroffer" };

function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * The three tabs. Needs you: every open requirement the carrier is not working on itself (the client,
 * the agent or a third party has to act), and counteroffers waiting on the client — oldest first, so
 * the reddest is on top. At carrier: submitted attempts with nothing waiting on anyone but the carrier.
 * Issued: closed as issued in this calendar month (the device's month).
 */
export function pendingTabs(pending: PendingAnswer, apps: ApplicationRow[], now = Date.now()) {
  const needs = pending.requirements.filter((r) => OPEN.has(r.status) && r.waitingOn !== "carrier");
  const needsApps = new Set<string>();
  const needsYou: CaseRowModel[] = [...needs]
    .sort((a, b) => b.daysOpen - a.daysOpen)
    .map((r) => {
      needsApps.add(r.applicationId);
      const n = needOf(r.kind);
      const what = r.kind === "other" && r.description.trim() ? r.description.trim() : n.noun;
      return { key: `req-${r.id}`, caseId: r.caseId, requirementId: r.id, title: displayName(r.clientName), meta: [r.carrierName, what].filter(Boolean).join(" · "), icon: n.icon, tone: "warn" as Tone, chip: n.chip };
    });
  for (const o of pending.counteroffers) {
    if (o.status !== "pending_client") continue;
    if (o.applicationId) needsApps.add(o.applicationId);
    const by = o.expiresAt ? `answer by ${dayLabel(dayKey(new Date(o.expiresAt), deviceZoneSafe()))}` : "waiting on the client";
    needsYou.push({ key: `co-${o.id}`, caseId: o.caseId, title: displayName(o.clientName), meta: [o.carrierName, by].filter(Boolean).join(" · "), icon: "scale", tone: "warn", chip: "Counteroffer" });
  }

  const atCarrier: CaseRowModel[] = apps
    .filter((a) => AT_CARRIER.has(a.status) && !needsApps.has(a.applicationId))
    .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt))
    .map((a) => {
      const days = daysSince(a.submittedAt ?? a.updatedAt, now);
      const when = days === 0 ? "submitted today" : days == null ? null : `day ${days}`;
      return { key: `app-${a.applicationId}`, caseId: a.caseId, title: displayName(a.clientName), meta: [a.carrierName, when].filter(Boolean).join(" · "), icon: "hourglass", tone: "info", chip: CARRIER_STATUS[a.status] ?? "At carrier" };
    });

  const month = new Date(now);
  const issued: CaseRowModel[] = apps
    .filter((a) => {
      if (a.status !== "closed" || a.outcome !== "issued" || !a.closedAt) return false;
      const d = new Date(a.closedAt);
      return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
    })
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
    .map((a) => ({ key: `iss-${a.applicationId}`, caseId: a.caseId, title: displayName(a.clientName), meta: [a.carrierName, a.closedAt ? `issued ${dayLabel(dayKey(new Date(a.closedAt), deviceZoneSafe()))}` : null].filter(Boolean).join(" · "), icon: "checkC", tone: "ok", chip: "Issued" }));

  return { needsYou, atCarrier, issued };
}

function deviceZoneSafe(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function matches(row: CaseRowModel, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || row.title.toLowerCase().includes(s) || row.meta.toLowerCase().includes(s);
}

// ─── E6 · Case detail ────────────────────────────────────────────────────────────────────────────
/**
 * The attempt the screen is about: the one holding the requirement that was tapped, else the newest
 * attempt that reached the carrier, else the newest attempt.
 */
export function pickAttempt(view: CaseView, requirementId?: string | null): CaseAttempt | null {
  if (!view.attempts.length) return null;
  if (requirementId) {
    const hit = view.attempts.find((a) => a.requirements.some((r) => r.id === requirementId));
    if (hit) return hit;
  }
  const newest = [...view.attempts].sort((a, b) => b.attemptNo - a.attemptNo);
  return newest.find((a) => a.status !== "draft" && a.status !== "ready") ?? newest[0];
}

export function selectedQuote(a: CaseAttempt): CaseQuote | null {
  return a.quotes.find((q) => q.id === a.selectedQuoteId) ?? a.quotes.find((q) => q.status === "selected") ?? null;
}

export function latestSubmission(a: CaseAttempt) {
  return [...a.submissions].sort((x, y) => y.submittedAt.localeCompare(x.submittedAt))[0] ?? null;
}

/** A monthly premium to the cent, as the carrier quoted it ("$71.40"): the application screens print it so. */
export function cents(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Corebridge SIWL · $20,000 · $71.40/mo" (board E6) — the reference is drawn apart, in mono. */
export function caseLine(a: CaseAttempt): string {
  const q = selectedQuote(a);
  const product = [a.carrierName ?? q?.carrierName, a.productLabel ?? q?.productLabel].filter(Boolean).join(" ");
  return [product || null, q ? dollars(q.faceAmountCents) : null, q ? `${cents(q.monthlyPremiumCents)}/mo` : null].filter(Boolean).join(" · ");
}

/** "Dr. Amin's office · asked Wed 19 Nov · day 5 of 30" (the "of" only when the carrier set a due date). */
export function requirementLine(r: CaseRequirement, now = Date.now()): string {
  return [r.description.trim() || null, requirementMeta(r, now)].filter(Boolean).join(" · ");
}

/** The quiet half of the line: "asked Wed 19 Nov · day 5 of 30" (the card draws it under the description). */
export function requirementMeta(r: CaseRequirement, now = Date.now()): string {
  const raised = Date.parse(`${r.raisedAt.slice(0, 10)}T12:00:00Z`);
  const day = Number.isNaN(raised) ? null : Math.max(0, Math.floor((now - raised) / 86_400_000));
  const due = r.dueAt ? Date.parse(`${r.dueAt.slice(0, 10)}T12:00:00Z`) : NaN;
  const span = Number.isNaN(due) || Number.isNaN(raised) ? null : Math.round((due - raised) / 86_400_000);
  const asked = `asked ${dayLabel(r.raisedAt.slice(0, 10))}`;
  // Past the carrier's due date, "day 55 of 14" reads as a typo; say how far past it is instead.
  const late = day != null && span && span > 0 && day > span ? day - span : 0;
  const count = day == null ? null : late ? `${late} ${late === 1 ? "day" : "days"} past the carrier's ${span}` : span && span > 0 ? `day ${day} of ${span}` : `day ${day}`;
  return [asked, count].filter(Boolean).join(" · ");
}

/** How "Send to" names a requirement (board E6b "requirement APS"). */
export const KIND_SHORT: Record<RequirementKind, string> = {
  aps: "APS", missing_info: "missing information", amendment: "amendment", voice_verification: "voice verification",
  phone_interview: "phone interview", paramed_exam: "paramedical exam", counteroffer: "counteroffer", other: "carrier request",
};

export function waitingChip(r: CaseRequirement): { tone: Tone; text: string } {
  // Pages sent from the phone hand the requirement back to the carrier, in progress (E6b "turns to Sent").
  if (r.waitingOn === "carrier" && r.status === "in_progress") return { tone: "info", text: "Sent" };
  if (r.waitingOn === "carrier") return { tone: "info", text: "With the carrier" };
  if (r.status === "in_progress") return { tone: "info", text: "In progress" };
  return { tone: "warn", text: needOf(r.kind).chip };
}

export function openRequirements(a: CaseAttempt): CaseRequirement[] {
  return a.requirements.filter((r) => OPEN.has(r.status) && r.kind !== "counteroffer");
}

/** The case's own events for this attempt, newest first; the newest is where it is now. */
export function whereItIs(events: CaseEvent[], attemptNo: number, max = 6) {
  return events
    .filter((e) => e.attemptNo == null || e.attemptNo === attemptNo)
    .slice(0, max)
    .map((e, i) => ({ id: e.id, title: e.title, meta: [dayLabel(dayKey(new Date(e.at), deviceZoneSafe())), e.by].filter(Boolean).join(" · "), muted: i > 0 }));
}

const WELCOME: Record<string, string> = { not_sent: "Welcome pack not sent", queued: "Welcome pack queued", sent: "Welcome pack sent", bounced: "Welcome pack bounced", review: "Welcome pack needs review" };
const INTERVIEW: Record<CaseRequirement["status"], string> = { open: "Not done yet", in_progress: "In progress", satisfied: "Done", waived: "Waived", expired: "Expired" };

/** The first date after `from` (a "YYYY-MM-DD") that falls on `day` of the month. */
function nextOn(day: number, from: string): string {
  const [y, m, d] = from.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (day > d) return `${y}-${pad(m)}-${pad(day)}`;
  return m === 12 ? `${y + 1}-01-${pad(day)}` : `${y}-${pad(m + 1)}-${pad(day)}`;
}

/**
 * Board E6 "Still to come": Phone interview (when the carrier asked for one), Payment (the first draft:
 * the first time the saved draft day comes round after the submission, while that is still ahead) and
 * Policy delivery — each from what the case records; a fact with no data is left out.
 */
export function stillToCome(a: CaseAttempt, today = dayKey(new Date(), deviceZoneSafe())): [string, string][] {
  const sub = latestSubmission(a);
  const out: [string, string][] = [];
  const interview = a.requirements.filter((r) => r.kind === "phone_interview").sort((x, y) => y.raisedAt.localeCompare(x.raisedAt))[0];
  if (interview) out.push(["Phone interview", INTERVIEW[interview.status] ?? interview.status]);
  if (a.payment?.draftDay) {
    const first = nextOn(a.payment.draftDay, (sub?.submittedAt ?? `${today}T12:00:00Z`).slice(0, 10));
    out.push(["Payment", first >= today ? `First draft ${dayLabel(first).replace(/^\w+ /, "")}` : `Drafts on the ${ordinal(a.payment.draftDay)}`]);
  }
  const policy = sub?.policyNumber?.trim();
  out.push(["Policy delivery", a.welcomePack ? WELCOME[a.welcomePack.status] ?? a.welcomePack.status : a.outcome === "issued" ? (policy ? `Policy ${policy}` : "Issued") : "After issue"]);
  return out;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

// ─── E7 · Daily deal flow ────────────────────────────────────────────────────────────────────────
export type DealRow = {
  id: string; lead_id: string; insured_name: string | null; agent_name: string; carrier: string | null; partner_name: string;
  monthly_premium_cents: number | null; created_at: string; disposition_at: string | null; stage_name: string | null; stage_type: "open" | "won" | "lost" | null;
};
export type DealKpis = { deals_worked: number; won: number; won_annualised_cents: number; won_unpriced: number; in_progress: number; oldest_in_progress_days: number | null; lost: number };
export type DealAnswer = { rows: DealRow[]; total: number; kpis: DealKpis };

/** The web shows premium to the roles its deal-flow page lets in: owners and producers. */
export function seesPremium(role: string | null | undefined): boolean {
  return role === "owner" || role === "producer";
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/**
 * Board E7 "Written today": the deals written (a won stage), newest first, the time it was written, the
 * annual premium (premium roles only). The one problem a row can show is "Unsigned": the lead's
 * application has not reached the carrier yet (`unsigned`, lead ids from the Applications list).
 */
export function dealRows(rows: DealRow[], zone: string, money: boolean, unsigned: ReadonlySet<string> = new Set()) {
  return rows
    .filter((r) => r.stage_type === "won")
    .sort((a, b) => (b.disposition_at ?? b.created_at).localeCompare(a.disposition_at ?? a.created_at))
    .map((r) => {
      const at = new Date(r.disposition_at ?? r.created_at);
      return {
        id: r.id, leadId: r.lead_id, avatar: initials(r.agent_name), title: r.insured_name?.trim() || "Unnamed client",
        meta: [r.agent_name, r.carrier ?? (r.partner_name !== "No partner" ? r.partner_name : null), Number.isNaN(at.getTime()) ? null : clock(at, zone)].filter(Boolean).join(" · "),
        right: money && r.monthly_premium_cents != null ? dollars(r.monthly_premium_cents * 12) : null,
        chip: unsigned.has(r.lead_id) ? "Unsigned" : null,
      };
    });
}

/**
 * The leads whose newest application is still on the phone side of the carrier (a draft, or marked
 * ready and waiting on the client's signature): a written deal for one of them is "Unsigned".
 */
export function unsignedLeads(apps: { leadId: string; status: ApplicationStatus; updatedAt: string; insuredRole?: string }[]): Set<string> {
  const newest = new Map<string, { status: ApplicationStatus; updatedAt: string }>();
  for (const a of apps) {
    if (a.insuredRole && a.insuredRole !== "primary") continue;
    const had = newest.get(a.leadId);
    if (!had || a.updatedAt > had.updatedAt) newest.set(a.leadId, a);
  }
  return new Set([...newest].filter(([, a]) => a.status === "draft" || a.status === "ready").map(([id]) => id));
}

/** "↑ $1,104 vs last Tue": today's written premium against the same weekday a week before. */
export function versusLastWeek(today: number, before: number, day: string): { up: boolean | null; amount: string; label: string } {
  const diff = today - before;
  const label = `vs last ${weekday(addDays(day, -7))}`;
  if (diff === 0) return { up: null, amount: "", label: `Same as last ${weekday(addDays(day, -7))}` };
  return { up: diff > 0, amount: dollars(Math.abs(diff)), label };
}

/** The last seven days, for the calendar button: today first. */
export function recentDays(today: string): { key: string; label: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(today, -i);
    return { key, label: i === 0 ? "Today" : i === 1 ? "Yesterday" : dayLabel(key) };
  });
}
