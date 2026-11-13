/**
 * LA-6.7 (Notion sprint, Module 6 — Compliance) · am I exposed right now? Two zones, and the split is
 * the design: deadlines and active problems on top, in a fixed order of severity; standing coverage
 * figures below. Pure: every number is passed in from the module that owns it.
 *
 * Absent, not guessed: a figure that cannot be computed reads "not configured" with a link to fix
 * it — never a zero. A non-zero count of calls outside legal hours is an incident, not a statistic.
 */

export type AlertSeverity = "incident" | "critical" | "warning";
/**
 * One row of Needs you (round 7, owner 2026-11-11: one line a row, colour only in the chip). `title` is the short
 * problem, `who` the person, number or thing it is about, `count` how many, `since` the date that matters (a due
 * date, an expiry), `chip` the few words in the row's one StatusChip and `step` the short verb that opens the fix.
 * `text` is the old sentence, kept for the row's tooltip and the monthly email.
 */
export type DashboardAlert = { key: string; severity: AlertSeverity; text: string; href: string; action: string; title: string; who: string; count: number | null; since: string | null; chip: string; step: string };

export type Tile = {
  key: TileKey;
  label: string;
  /** null when it cannot be computed: then `notConfigured` says why and `href` is the fix. */
  value: string | null;
  footnote: string;
  tone?: "danger" | "warning";
  /** Round 7 (owner 2026-11-11): the figure is plain; a tile with a tone says it in one StatusChip with these words. */
  chip?: string;
  href: string;
  action: string;
  notConfigured?: string;
};

export const TILE_KEYS = ["consent_coverage", "campaigns_scrubbed", "outside_hours", "dnc_size", "screened_before_transfer", "deletions_and_holds", "legal_holds"] as const;
export type TileKey = (typeof TILE_KEYS)[number];
export const TILE_LABELS: Record<TileKey, string> = {
  consent_coverage: "Consent proof held",
  campaigns_scrubbed: "Campaigns scrubbed <30d",
  outside_hours: "Calls outside legal hours",
  dnc_size: "Internal DNC list",
  screened_before_transfer: "Screened before transfer",
  // Round 7 (Notion LA-6.7): open deletion requests and legal holds are two figures, each opening its own rows. The key
  // stays "deletions_and_holds" so a tile already hidden in Settings stays hidden; hiding it hides the holds tile too.
  deletions_and_holds: "Open deletion requests",
  legal_holds: "Legal holds",
};

export type Figures = {
  called_numbers: number;
  consented_called_numbers: number;
  dnc_active: number;
  campaigns_active: number;
  campaigns_scrubbed_30d: number;
  transfers_accepted: number;
  transfers_screened_before: number;
  deletions_open: number;
  holds_active: number;
  last_run_held: number | null;
  purge_scheduled: boolean;
  unruled_types: string[];
  /** The scheduled live purge that was skipped (summary unseen, or rules changed), until a live run follows. 20261015630000. */
  purge_live_skipped?: { at: string; reason: string } | null;
};

export const PURGE_SKIP_REASONS: Record<string, string> = {
  summary_not_delivered: "nobody received or acknowledged the dry run's summary",
  rules_changed: "the retention rules changed after the dry run",
};

export type GapLine = { category: string; numbers: number; count: number; undeterminedCount: number; undeterminedReason: string | null };
export type ComplaintCountdown = { id: string; channel: string; regulatorState: string | null; tone: string; daysLeft: number | null; label: string; complainant?: string | null; dueAt?: string | null };
/** The nightly index reconciliation (LA-6.1): a non-zero missing count is a bug. */
export type Reconciliation = { ranAt: string; missing: number } | null;
export type Expiry = { kind: "licence"; name: string; expiresAt: string };

const DAY = 86_400_000;
const n = (x: number) => x.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const regName = (c: ComplaintCountdown) => (c.channel === "ftc" ? "FTC" : `${c.regulatorState ?? ""} DOI`.trim());

const STATE_NAMES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

/** The top zone, in a fixed order of severity. */
export function dashboardAlerts(input: {
  complaints: ComplaintCountdown[] | null;
  gaps: GapLine[] | null;
  expiries: Expiry[];
  deadlineCoverage: { missing: string[]; licensed: number; sentence: string } | null;
  now: Date;
  windowDays?: number;
  /** Sources that failed to answer (not "not set up"): said, never shown as nothing to report. */
  failed?: { gaps?: boolean; complaints?: boolean; figures?: boolean };
  purgeSkipped?: { at: string; reason: string } | null;
  reconciliation?: Reconciliation;
}): DashboardAlert[] {
  const out: DashboardAlert[] = [];
  // A check that could not run is not a clean bill of health: say so where the alerts would be.
  if (input.failed?.complaints) out.push({ key: "complaints_unchecked", severity: "critical", text: "Couldn't check complaint deadlines just now — overdue regulator complaints may not be shown", href: "/app/complaints", action: "Open complaints", title: "Complaint deadlines not checked", who: "Complaints", count: null, since: null, chip: "Not checked", step: "Open" });
  if (input.failed?.gaps) out.push({ key: "gaps_unchecked", severity: "critical", text: "Couldn't check your book for calls after DNC, after a complaint or outside legal hours just now — do not read the empty list as clean", href: "/app/evidence-report", action: "Run the scan", title: "Book not checked", who: "Evidence scan", count: null, since: null, chip: "Not checked", step: "Run the scan" });
  if (input.reconciliation && input.reconciliation.missing > 0) out.push({ key: "index_missing", severity: "incident", text: `Last night's index check found ${plural(input.reconciliation.missing, "record")} missing from the compliance index — a missing record is a bug`, href: "/app/compliance/settings#index-checks", action: "Check", title: "Index check found records missing", who: "Compliance record index", count: input.reconciliation.missing, since: input.reconciliation.ranAt.slice(0, 10), chip: "Should be 0", step: "Check" });
  if (input.purgeSkipped) out.push({ key: "purge_skipped", severity: "warning", text: `The scheduled record purge did not run: ${PURGE_SKIP_REASONS[input.purgeSkipped.reason] ?? input.purgeSkipped.reason.replace(/_/g, " ")}. A new dry run follows.`, href: "/app/compliance/settings#purge", action: "Review", title: "Scheduled purge did not run", who: "Retention schedule", count: null, since: input.purgeSkipped.at.slice(0, 10), chip: "Skipped", step: "Review" });
  // Each problem opens its own fix (LA-6.7 "everything clicks through"; one Compliance page, 2026-10-30):
  // one complaint opens itself, a finding opens the scan with its numbers showing, a licence opens Licences.
  const window = input.windowDays ?? 60;
  const reg = (input.complaints ?? []).filter((c) => c.channel === "doi" || c.channel === "ftc");
  const overdue = reg.filter((c) => c.tone === "overdue");
  if (overdue.length) out.push({ key: "complaints_overdue", severity: "incident", text: `${plural(overdue.length, "regulator complaint")} past the response deadline`, href: overdue.length === 1 ? `/app/complaints/${overdue[0].id}` : "/app/complaints?view=due", action: "Respond now", title: overdue.length === 1 ? `${regName(overdue[0])} complaint past its deadline` : "Regulator complaints past their deadline", who: overdue.length === 1 ? overdue[0].complainant ?? "Complainant not named" : `${n(overdue.length)} complaints`, count: overdue.length, since: overdue.length === 1 ? overdue[0].dueAt?.slice(0, 10) ?? null : null, chip: overdue.length === 1 && overdue[0].daysLeft != null ? `Overdue ${plural(Math.abs(overdue[0].daysLeft), "day")}` : "Overdue", step: "Respond" });
  const hours = input.gaps?.find((g) => g.category === "outside_legal_hours");
  if (hours && hours.count > 0) out.push({ key: "outside_hours", severity: "incident", text: `${plural(hours.count, "call")} outside legal hours — calling-hours enforcement let these through`, href: "/app/evidence-report?focus=outside_legal_hours", action: "See the calls", title: "Calls outside legal hours", who: "Calling windows", count: hours.count, since: null, chip: "Should be 0", step: "See calls" });
  const soon = reg.filter((c) => c.tone === "red").sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  for (const c of soon) out.push({ key: `complaint_${c.id}`, severity: "critical", text: `${c.channel === "ftc" ? "FTC" : `${c.regulatorState ?? ""} DOI`.trim()} complaint — ${c.label.toLowerCase()}`, href: `/app/complaints/${c.id}`, action: "Open", title: `${regName(c)} complaint due soon`, who: c.complainant ?? "Complainant not named", count: 1, since: c.dueAt?.slice(0, 10) ?? null, chip: c.daysLeft != null ? `${plural(c.daysLeft, "day")} left` : c.label, step: "Respond" });
  const dnc = input.gaps?.find((g) => g.category === "called_after_dnc");
  if (dnc && dnc.numbers > 0) out.push({ key: "called_after_dnc", severity: "critical", text: `${plural(dnc.numbers, "number")} called after a DNC entry — fix today`, href: "/app/evidence-report?focus=called_after_dnc", action: "See the numbers", title: "Called after a do-not-call entry", who: plural(dnc.numbers, "number"), count: dnc.count, since: null, chip: "Fix today", step: "See numbers" });
  const complaint = input.gaps?.find((g) => g.category === "called_after_complaint");
  if (complaint && complaint.numbers > 0) out.push({ key: "called_after_complaint", severity: "critical", text: `${plural(complaint.numbers, "number")} called after a complaint — fix today`, href: "/app/evidence-report?focus=called_after_complaint", action: "See the numbers", title: "Called after a complaint", who: plural(complaint.numbers, "number"), count: complaint.count, since: null, chip: "Fix today", step: "See numbers" });
  const expiring = input.expiries
    // Calendar days, date to date: a licence expiring on 7 Nov is "23 days" from 15 Oct at any hour.
    .map((e) => ({ ...e, days: Math.round((Date.parse(`${e.expiresAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${input.now.toISOString().slice(0, 10)}T00:00:00Z`)) / DAY) }))
    .filter((e) => e.days <= window)
    .sort((a, b) => a.days - b.days);
  for (const e of expiring) {
    const what = `${STATE_NAMES[e.name] ?? e.name} licence`;
    out.push({ key: `${e.kind}_${e.name}`, severity: e.days < 0 ? "critical" : "warning", text: e.days < 0 ? `${what} expired ${plural(-e.days, "day")} ago` : `${what} expires in ${plural(e.days, "day")}`, href: `/app/appointments?tab=licences&state=${encodeURIComponent(e.name)}`, action: "Renew", title: e.days < 0 ? `${what} expired` : `${what} expires`, who: "Your licence", count: 1, since: e.expiresAt.slice(0, 10), chip: e.days < 0 ? "Expired" : `${plural(e.days, "day")} left`, step: "Renew" });
  }
  if (input.deadlineCoverage && input.deadlineCoverage.missing.length) out.push({ key: "deadlines_unset", severity: "warning", text: input.deadlineCoverage.sentence, href: "/app/compliance/settings#deadlines", action: "Set them", title: "Regulator deadlines not set", who: plural(input.deadlineCoverage.missing.length, "state"), count: input.deadlineCoverage.missing.length, since: null, chip: "Not set", step: "Set them" });
  const rank: Record<AlertSeverity, number> = { incident: 0, critical: 1, warning: 2 };
  return out.map((a, i) => ({ a, i })).sort((x, y) => rank[x.a.severity] - rank[y.a.severity] || x.i - y.i).map((x) => x.a);
}

/** The bottom zone: standing coverage. */
export function dashboardTiles(input: { figures: Figures | null; gaps: GapLine[] | null; hidden?: readonly string[] }): Tile[] {
  const f = input.figures;
  const unavailable = (key: TileKey, why: string, fix: string, action: string): Tile => ({ key, label: TILE_LABELS[key], value: null, footnote: why, href: fix, action, notConfigured: why });
  const tiles: Tile[] = [];
  // Consent coverage
  if (!f) tiles.push(unavailable("consent_coverage", "Needs the compliance record index.", "/app/compliance/settings", "Set up"));
  else if (!f.called_numbers) tiles.push({ key: "consent_coverage", label: TILE_LABELS.consent_coverage, value: "No calls yet", footnote: "nothing to cover", href: "/app/consent", action: "Consent locker" });
  else {
    const missing = f.called_numbers - f.consented_called_numbers;
    tiles.push({ key: "consent_coverage", label: TILE_LABELS.consent_coverage, value: `${n(f.consented_called_numbers)} of ${n(f.called_numbers)}`, footnote: missing ? "numbers called" : "every number called", tone: missing ? "warning" : undefined, chip: missing ? `${n(missing)} missing` : undefined, href: missing ? "/app/evidence-report?focus=calls_without_consent" : "/app/consent", action: missing ? `Open the ${n(missing)}` : "Details" });
  }
  // Campaigns scrubbed
  if (!f) tiles.push(unavailable("campaigns_scrubbed", "Needs a database update.", "/app/compliance/settings", "Set up"));
  else if (!f.campaigns_active) tiles.push({ key: "campaigns_scrubbed", label: TILE_LABELS.campaigns_scrubbed, value: "No active campaigns", footnote: "nothing to scrub", href: "/app/campaigns", action: "Campaigns" });
  else tiles.push({ key: "campaigns_scrubbed", label: TILE_LABELS.campaigns_scrubbed, value: `${n(f.campaigns_scrubbed_30d)} of ${n(f.campaigns_active)}`, footnote: "active campaigns", tone: f.campaigns_scrubbed_30d < f.campaigns_active ? "warning" : undefined, chip: f.campaigns_scrubbed_30d < f.campaigns_active ? `${n(f.campaigns_active - f.campaigns_scrubbed_30d)} not scrubbed` : undefined, href: "/app/campaigns", action: "Campaigns" });
  // Outside legal hours: should always be zero; anything else is an incident.
  const hours = input.gaps?.find((g) => g.category === "outside_legal_hours");
  if (!input.gaps || !hours) tiles.push(unavailable("outside_hours", "Calling-hours results not recorded yet.", "/app/compliance/settings", "Set up"));
  else tiles.push({ key: "outside_hours", label: TILE_LABELS.outside_hours, value: n(hours.count), footnote: hours.count ? `incident — should be zero${hours.undeterminedCount ? ` · ${n(hours.undeterminedCount)} could not be checked` : ""}` : hours.undeterminedCount ? `${n(hours.undeterminedCount)} could not be checked` : "as it should be", tone: hours.count ? "danger" : hours.undeterminedCount ? "warning" : undefined, chip: hours.count ? "Should be 0" : hours.undeterminedCount ? "Not all checked" : undefined, href: hours.count || hours.undeterminedCount ? "/app/evidence-report?focus=outside_legal_hours" : "/app/evidence-report", action: hours.count || hours.undeterminedCount ? "See the calls" : "Details" });
  // Internal DNC
  if (!f) tiles.push(unavailable("dnc_size", "Needs a database update.", "/app/compliance/settings", "Set up"));
  else tiles.push({ key: "dnc_size", label: TILE_LABELS.dnc_size, value: plural(f.dnc_active, "number"), footnote: "never deleted", href: "/app/tcpa", action: "Open the list" });
  // Screened before transfer
  if (!f) tiles.push(unavailable("screened_before_transfer", "Needs the transfer gate.", "/app/compliance/settings", "Set up"));
  else if (!f.transfers_accepted) tiles.push({ key: "screened_before_transfer", label: TILE_LABELS.screened_before_transfer, value: "No transfers yet", footnote: "nothing screened", href: "/app/partner-quality", action: "Partners" });
  else {
    const pct = Math.round((f.transfers_screened_before * 100) / f.transfers_accepted);
    tiles.push({ key: "screened_before_transfer", label: TILE_LABELS.screened_before_transfer, value: `${pct}%`, footnote: `${n(f.transfers_accepted - f.transfers_screened_before)} only at submit`, tone: pct < 90 ? "warning" : undefined, chip: pct < 90 ? `${n(f.transfers_accepted - f.transfers_screened_before)} only at submit` : undefined, href: "/app/partner-quality", action: "By partner" });
  }
  // Deletions and holds
  if (!f) tiles.push(unavailable("deletions_and_holds", "Needs a database update.", "/app/compliance/settings", "Set up"));
  else tiles.push({ key: "deletions_and_holds", label: TILE_LABELS.deletions_and_holds, value: n(f.deletions_open), footnote: f.deletions_open ? "not yet deleted" : "none open", href: "/app/deletion-requests", action: "Requests" });
  if (!f) tiles.push(unavailable("legal_holds", "Needs a database update.", "/app/compliance/settings", "Set up"));
  else tiles.push({ key: "legal_holds", label: TILE_LABELS.legal_holds, value: n(f.holds_active), footnote: f.last_run_held ? `${n(f.last_run_held)} records held at the last run` : "active holds", href: "/app/compliance/settings#holds", action: "Holds" });
  const hidden = new Set(input.hidden ?? []);
  if (hidden.has("deletions_and_holds")) hidden.add("legal_holds");
  return tiles.filter((t) => !hidden.has(t.key));
}
