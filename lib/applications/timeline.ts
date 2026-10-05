import "server-only";

import { APPLICATION_OUTCOME_LABEL, OUTCOME_REASONS, REQUIREMENT_KIND_LABEL, type ApplicationOutcome, type RequirementKind } from "./constants";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError } from "./db";

/**
 * LA-3.16 case timeline, "Everything that happened": one list assembled from the rows each step
 * already writes — the case, every attempt, submissions and their frozen verdicts, requirements,
 * counteroffers, disclosures, draft-day overrides, sensitive reveals and welcome packs — newest
 * first. Nothing here is stored twice; it is a read over the records themselves.
 */

export type TimelineEvent = {
  id: string;
  at: string;
  title: string;
  /** "Rinor G.", "system", a carrier name. */
  by: string | null;
  detail: string | null;
  tone: "good" | "warning" | "danger" | "neutral" | "info";
  attemptNo: number | null;
  insuredRole: "primary" | "spouse" | null;
};

async function optional<T>(q: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingSchema(error)) return [];
    throw new ApplicationError("APPLICATION_UNAVAILABLE", error.message ?? "Could not load the timeline", 500);
  }
  return rows<T>(data);
}

const shortName = (name: string | null | undefined) => {
  if (!name) return null;
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1].charAt(0)}.` : first;
};
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const FIELD_LABEL: Record<string, string> = { "insured.ssn": "SSN", "pay.routing_number": "Routing number", "pay.account_number": "Account number", "pay.card_number": "Card number" };
/**
 * `satisfied_at` is a calendar date. The row's own update carries the real time when it happened
 * that day; otherwise noon UTC keeps it inside the day it names.
 */
export function satisfiedAt(satisfiedOn: string | null, updatedAt: string) {
  if (!satisfiedOn) return updatedAt;
  return updatedAt.startsWith(satisfiedOn) ? updatedAt : `${satisfiedOn}T12:00:00.000Z`;
}
const METHOD: Record<string, string> = { read_aloud: "read aloud", emailed: "emailed", mailed: "mailed" };
// The work item's channel: an outbound case opens from the dialer and from the lead page alike.
const SOURCE: Record<string, string> = { inbound: "an inbound transfer", outbound: "an outbound lead", manual: "the lead record" };

export async function caseTimeline(tenantId: string, caseId: string): Promise<TimelineEvent[]> {
  const client = db();
  const kase = await client.from("tenant_application_cases").select("id, source, status, opened_at, opened_by, closed_at, closed_by, outcome_reason_code, outcome_reason_text").eq("tenant_id", tenantId).eq("id", caseId).maybeSingle();
  if (kase.error && !isMissingSchema(kase.error)) throw new ApplicationError("APPLICATION_UNAVAILABLE", kase.error.message, 500);
  if (!kase.data) throw new ApplicationError("CASE_NOT_FOUND", "That case could not be found.", 404);

  const attemptsQ = await client.from("tenant_applications").select("id, insured_role, attempt_no, carrier_id, quote_id, status, outcome, outcome_reason_code, outcome_reason_text, outcome_recorded_at, outcome_recorded_by, created_by, created_at, closed_at, supersedes_application_id").eq("tenant_id", tenantId).eq("case_id", caseId);
  if (attemptsQ.error) { if (isMissingSchema(attemptsQ.error)) throw new SchemaPendingError("The application record"); throw new ApplicationError("APPLICATION_UNAVAILABLE", attemptsQ.error.message, 500); }
  const attempts = rows<{ id: string; insured_role: "primary" | "spouse"; attempt_no: number; carrier_id: string | null; quote_id: string | null; status: string; outcome: ApplicationOutcome | null; outcome_reason_code: string | null; outcome_reason_text: string | null; outcome_recorded_at: string | null; outcome_recorded_by: string | null; created_by: string; created_at: string; closed_at: string | null; supersedes_application_id: string | null }>(attemptsQ.data);
  const ids = attempts.length ? attempts.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"];
  const quoteIds = [...new Set(attempts.map((a) => a.quote_id).filter((x): x is string => Boolean(x)))];

  const [subs, reqs, offers, discl, pays, reveals, packs, quotes, effective, interviews, caseQuotes] = await Promise.all([
    optional<{ id: string; application_id: string; carrier_reference: string | null; policy_number: string | null; submitted_at: string; submitted_via: string; qa_verdict: { verdict?: string } | null; created_by: string; confirmation_path: string | null }>(client.from("tenant_application_submissions").select("id, application_id, carrier_reference, policy_number, submitted_at, submitted_via, qa_verdict, created_by, confirmation_path").eq("tenant_id", tenantId).in("application_id", ids)),
    optional<{ id: string; application_id: string; kind: RequirementKind; description: string | null; waiting_on: string; status: string; raised_at: string; created_at: string; created_by: string; satisfied_at: string | null; last_chased_at: string | null; chase_count: number; updated_at: string }>(client.from("tenant_application_requirements").select("id, application_id, kind, description, waiting_on, status, raised_at, created_at, created_by, satisfied_at, last_chased_at, chase_count, updated_at").eq("tenant_id", tenantId).in("application_id", ids)),
    optional<{ id: string; application_id: string; received_at: string; offered_face_cents: number | null; offered_monthly_premium_cents: number | null; status: string; responded_at: string | null; responded_by: string | null; created_by: string | null; updated_at: string }>(client.from("tenant_application_counteroffers").select("id, application_id, received_at, offered_face_cents, offered_monthly_premium_cents, status, responded_at, responded_by, created_by, updated_at").eq("tenant_id", tenantId).in("application_id", ids)),
    optional<{ application_id: string; disclosure_id: string; status: string; method: string | null; acknowledged_by: string | null; acknowledged_at: string | null; note: string | null }>(client.from("tenant_application_disclosures").select("application_id, disclosure_id, status, method, acknowledged_by, acknowledged_at, note").eq("tenant_id", tenantId).in("application_id", ids).neq("status", "required")),
    optional<{ application_id: string; draft_day_overridden_at: string | null; draft_day_overridden_by: string | null; draft_day_override_reason: string | null }>(client.from("tenant_application_payment_methods").select("application_id, draft_day_overridden_at, draft_day_overridden_by, draft_day_override_reason").eq("tenant_id", tenantId).in("application_id", ids)),
    optional<{ id: string; application_id: string | null; user_id: string | null; field_key: string; action: string; surface: string; at: string }>(client.from("tenant_sensitive_access_log").select("id, application_id, user_id, field_key, action, surface, at").eq("tenant_id", tenantId).in("application_id", ids).order("at", { ascending: false }).limit(200)),
    optional<{ application_id: string; email_status: string; recipient_email: string | null; sent_at: string | null; bounced_at: string | null; created_at: string }>(client.from("tenant_welcome_packs").select("application_id, email_status, recipient_email, sent_at, bounced_at, created_at").eq("tenant_id", tenantId).in("application_id", ids)),
    quoteIds.length ? optional<{ id: string; monthly_premium_cents: number }>(client.from("tenant_quotes").select("id, monthly_premium_cents").eq("tenant_id", tenantId).in("id", quoteIds)) : Promise.resolve([]),
    // The effective premium: an accepted counteroffer (LA-3.26) writes it over the quoted one.
    optional<{ application_id: string; value: unknown }>(client.from("tenant_application_values").select("application_id, value").eq("tenant_id", tenantId).eq("field_key", "cov.monthly_premium").in("application_id", ids)),
    // The interview and every quote typed on the call are part of what happened, not only the one picked.
    optional<{ id: string; insured_role: "primary" | "spouse"; started_at: string; started_by: string | null; completed_at: string | null }>(client.from("tenant_uw_interviews").select("id, insured_role, started_at, started_by, completed_at").eq("tenant_id", tenantId).eq("case_id", caseId)),
    optional<{ id: string; application_id: string | null; insured_role: "primary" | "spouse"; carrier_id: string; face_amount_cents: number; monthly_premium_cents: number; created_by: string | null; created_at: string }>(client.from("tenant_quotes").select("id, application_id, insured_role, carrier_id, face_amount_cents, monthly_premium_cents, created_by, created_at").eq("tenant_id", tenantId).eq("case_id", caseId)),
  ]);
  const quotedBy = new Map(quotes.map((q) => [q.id, q.monthly_premium_cents]));
  const effectiveBy = new Map(effective.filter((v) => typeof v.value === "number" && Number.isInteger(v.value) && (v.value as number) > 0).map((v) => [v.application_id, v.value as number]));

  const carrierIds = [...new Set([...attempts.map((a) => a.carrier_id), ...caseQuotes.map((q) => q.carrier_id)].filter((x): x is string => Boolean(x)))];
  const disclosureIds = [...new Set(discl.map((d) => d.disclosure_id))];
  const userIds = [...new Set([
    kase.data.opened_by, kase.data.closed_by, ...attempts.flatMap((a) => [a.created_by, a.outcome_recorded_by]), ...subs.map((s) => s.created_by), ...reqs.map((r) => r.created_by),
    ...offers.flatMap((o) => [o.created_by, o.responded_by]), ...interviews.map((i) => i.started_by), ...caseQuotes.map((q) => q.created_by), ...discl.map((d) => d.acknowledged_by), ...pays.map((p) => p.draft_day_overridden_by), ...reveals.map((r) => r.user_id),
  ].filter((x): x is string => Boolean(x)))];
  const [carriers, library, users] = await Promise.all([
    carrierIds.length ? optional<{ id: string; name: string }>(client.from("carriers").select("id, name").in("id", carrierIds)) : Promise.resolve([]),
    disclosureIds.length ? optional<{ id: string; title: string }>(client.from("application_disclosures").select("id, title").in("id", disclosureIds)) : Promise.resolve([]),
    userIds.length ? optional<{ id: string; name: string | null }>(client.from("users").select("id, name").in("id", userIds)) : Promise.resolve([]),
  ]);
  const carrierBy = new Map(carriers.map((c) => [c.id, c.name]));
  const titleBy = new Map(library.map((d) => [d.id, d.title]));
  const who = new Map(users.map((u) => [u.id, shortName(u.name) ?? "A colleague"]));
  const person = (id: string | null | undefined) => (id ? who.get(id) ?? "A colleague" : null);
  const attemptBy = new Map(attempts.map((a) => [a.id, a]));
  const carrierOf = (appId: string) => {
    const a = attemptBy.get(appId);
    return a?.carrier_id ? carrierBy.get(a.carrier_id) ?? "the carrier" : "the carrier";
  };
  const tag = (appId: string | null) => {
    const a = appId ? attemptBy.get(appId) : undefined;
    return { attemptNo: a?.attempt_no ?? null, insuredRole: a?.insured_role ?? null };
  };
  const money = (c: number | null) => (c ? `$${(c / 100).toFixed(2)}` : "—");
  const face = (c: number | null) => (c ? `$${Math.round(c / 100).toLocaleString("en-US")}` : "—");
  const reasonLabel = (code: string | null) => OUTCOME_REASONS.find((r) => r.code === code)?.label ?? code;

  const ev: TimelineEvent[] = [];
  const add = (e: Omit<TimelineEvent, "id"> & { key: string }) => { const { key, ...rest } = e; ev.push({ id: key, ...rest }); };

  add({ key: `case-open-${caseId}`, at: kase.data.opened_at, title: `Case opened from ${SOURCE[kase.data.source] ?? "the lead"}`, by: person(kase.data.opened_by), detail: null, tone: "neutral", attemptNo: null, insuredRole: null });
  if (kase.data.status === "lost" && kase.data.closed_at) add({ key: `case-lost-${caseId}`, at: kase.data.closed_at, title: "Case closed as lost", by: person(kase.data.closed_by), detail: [reasonLabel(kase.data.outcome_reason_code), kase.data.outcome_reason_text].filter(Boolean).join(" — ") || null, tone: "danger", attemptNo: null, insuredRole: null });
  if (kase.data.status === "won" && kase.data.closed_at) add({ key: `case-won-${caseId}`, at: kase.data.closed_at, title: "Case won", by: "system", detail: null, tone: "good", attemptNo: null, insuredRole: null });

  // LA-3.16 · every attempt with its carrier and premium (the effective one after an accepted
  // counteroffer), and on its outcome the reason.
  const terms = (a: (typeof attempts)[number]) => {
    const monthly = effectiveBy.get(a.id) ?? (a.quote_id ? quotedBy.get(a.quote_id) ?? null : null);
    const carrier = a.carrier_id ? carrierBy.get(a.carrier_id) ?? "Carrier" : "No carrier chosen yet";
    return monthly ? `${carrier} · ${money(monthly)} a month` : carrier;
  };
  for (const a of attempts) {
    const who2 = a.insured_role === "spouse" ? "Spouse attempt" : "Attempt";
    const started = [terms(a), a.supersedes_application_id ? "Carried forward: health, medications, address, beneficiaries, payment." : null].filter(Boolean).join(" · ");
    // Not "started with <carrier>": the carrier is today's, and a quote usually picks it later.
    add({ key: `att-${a.id}`, at: a.created_at, title: `${who2} ${a.attempt_no} started`, by: person(a.created_by), detail: started, tone: "neutral", ...tag(a.id) });
    if (a.status === "closed" && a.outcome && a.closed_at) {
      const why = [reasonLabel(a.outcome_reason_code), a.outcome_reason_text].filter(Boolean).join(" — ");
      add({ key: `out-${a.id}`, at: a.closed_at, title: `${who2} ${a.attempt_no} ${APPLICATION_OUTCOME_LABEL[a.outcome].toLowerCase()}${why ? ` — ${why}` : ""}`, by: a.outcome === "offer_expired" ? "system" : person(a.outcome_recorded_by) ?? (a.carrier_id ? carrierBy.get(a.carrier_id) ?? null : null), detail: terms(a), tone: a.outcome === "issued" ? "good" : a.outcome === "withdrawn" ? "neutral" : "danger", ...tag(a.id) });
    }
  }
  for (const s of subs) {
    add({ key: `sub-${s.id}`, at: s.submitted_at, title: `Submitted to ${carrierOf(s.application_id)}${s.carrier_reference ? ` · ${s.carrier_reference}` : " — reference missing"}`, by: person(s.created_by), detail: s.confirmation_path ? "Confirmation attached" : null, tone: s.carrier_reference ? "good" : "warning", ...tag(s.application_id) });
    add({ key: `qa-${s.id}`, at: s.submitted_at, title: `QA verdict frozen: ${(s.qa_verdict?.verdict ?? "pass").replace(/_/g, " ")}`, by: "system", detail: null, tone: "neutral", ...tag(s.application_id) });
    // A policy number arrives with the issue, not when the application went in.
    const issuedAttempt = attemptBy.get(s.application_id);
    const issuedAt = issuedAttempt?.outcome === "issued" ? issuedAttempt.outcome_recorded_at ?? issuedAttempt.closed_at : null;
    if (s.policy_number && s.policy_number !== s.carrier_reference) add({ key: `pol-${s.id}`, at: issuedAt ?? s.submitted_at, title: `Policy number ${s.policy_number} recorded`, by: null, detail: null, tone: "good", ...tag(s.application_id) });
  }
  for (const r of reqs) {
    const label = REQUIREMENT_KIND_LABEL[r.kind] ?? r.kind;
    add({ key: `req-${r.id}`, at: r.created_at, title: `${carrierOf(r.application_id)} asked for: ${label}`, by: person(r.created_by), detail: r.description, tone: "warning", ...tag(r.application_id) });
    if (r.last_chased_at && r.chase_count > 0) add({ key: `chase-${r.id}`, at: r.last_chased_at, title: `${label} chased (${ordinal(r.chase_count)} time)`, by: null, detail: null, tone: "neutral", ...tag(r.application_id) });
    if ((r.status === "satisfied" || r.status === "waived" || r.status === "expired") && r.kind !== "counteroffer") add({ key: `reqdone-${r.id}`, at: satisfiedAt(r.satisfied_at, r.updated_at), title: `${label} ${r.status}`, by: null, detail: null, tone: r.status === "satisfied" ? "good" : "neutral", ...tag(r.application_id) });
  }
  for (const iv of interviews) {
    const whose = iv.insured_role === "spouse" ? "Spouse's interview" : "Interview";
    add({ key: `iv-${iv.id}`, at: iv.started_at, title: `${whose} started`, by: person(iv.started_by), detail: null, tone: "neutral", attemptNo: null, insuredRole: iv.insured_role });
    if (iv.completed_at) add({ key: `ivdone-${iv.id}`, at: iv.completed_at, title: `${whose} completed`, by: null, detail: null, tone: "good", attemptNo: null, insuredRole: iv.insured_role });
  }
  for (const q of caseQuotes) {
    add({ key: `quote-${q.id}`, at: q.created_at, title: `Quoted ${carrierBy.get(q.carrier_id) ?? "a carrier"}`, by: person(q.created_by), detail: `${face(q.face_amount_cents)} at ${money(q.monthly_premium_cents)} a month`, tone: "neutral", ...(q.application_id ? tag(q.application_id) : { attemptNo: null, insuredRole: q.insured_role }) });
  }
  for (const o of offers) {
    add({ key: `co-${o.id}`, at: o.received_at, title: `Counteroffer received from ${carrierOf(o.application_id)}`, by: person(o.created_by), detail: `${face(o.offered_face_cents)} at ${money(o.offered_monthly_premium_cents)} a month`, tone: "warning", ...tag(o.application_id) });
    if (o.status !== "pending_client") add({ key: `coans-${o.id}`, at: o.responded_at ?? o.updated_at, title: o.status === "accepted" ? "Client accepted the counteroffer" : o.status === "rejected" ? "Client refused the counteroffer" : "Counteroffer expired", by: o.status === "expired" ? "system" : person(o.responded_by), detail: null, tone: o.status === "accepted" ? "good" : "danger", ...tag(o.application_id) });
  }
  for (const d of discl) {
    if (!d.acknowledged_at) continue;
    const title = titleBy.get(d.disclosure_id) ?? "Disclosure";
    add({ key: `dis-${d.application_id}-${d.disclosure_id}`, at: d.acknowledged_at, title: d.status === "acknowledged" ? `${title} acknowledged${d.method ? `, ${METHOD[d.method] ?? d.method}` : ""}` : `${title} marked not applicable`, by: person(d.acknowledged_by), detail: d.status === "not_applicable" ? d.note : null, tone: d.status === "acknowledged" ? "good" : "neutral", ...tag(d.application_id) });
  }
  for (const p of pays) {
    if (p.draft_day_overridden_at) add({ key: `dd-${p.application_id}`, at: p.draft_day_overridden_at, title: "Draft day set against the recommendation", by: person(p.draft_day_overridden_by), detail: p.draft_day_override_reason, tone: "neutral", ...tag(p.application_id) });
  }
  for (const r of reveals) {
    add({ key: `rev-${r.id}`, at: r.at, title: `${FIELD_LABEL[r.field_key] ?? r.field_key} ${r.action === "extension_read" ? "read by the extension" : "revealed"}`, by: person(r.user_id), detail: `${r.surface === "copy_assist" ? "Copy-assist" : r.surface === "extension" ? "Extension" : "Web"} · access record ${r.id.slice(0, 8)}`, tone: "neutral", ...tag(r.application_id) });
  }
  for (const w of packs) {
    if (w.sent_at) add({ key: `wp-${w.application_id}`, at: w.sent_at, title: `Welcome pack sent${w.recipient_email ? ` to ${w.recipient_email}` : ""}`, by: "system", detail: null, tone: "good", ...tag(w.application_id) });
    if (w.bounced_at) add({ key: `wpb-${w.application_id}`, at: w.bounced_at, title: "Welcome pack bounced", by: "system", detail: w.recipient_email, tone: "danger", ...tag(w.application_id) });
  }

  return ev.filter((e) => Boolean(e.at)).sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
}
