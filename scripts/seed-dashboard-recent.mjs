/**
 * Recent activity for the demo agency's dashboard (2026-10-13).
 *
 * The outbound demo seed (scripts/seed-demo-outbound.mjs) stops its history at 25 Sep on purpose,
 * so two weeks later every "last 7 / 14 days" panel on /app/dashboard is empty: dials, reached,
 * contact rate, the outcome mix, the hour heatmap, top dialers, today's appointments and the
 * close-out strip. This fills the last 14 days (up to now) so those visuals have something to show.
 *
 * What it writes, all in tenant d6f3950f-0d88-4e66-869f-0de2ea6b396b only:
 *   - tenant_call_attempts: dials by the demo producers and setters (and a few by the owner), on
 *     leads the outbound seed already tagged (values.qa_seed = "design2-outbound") that have no open
 *     callback, weekday-heavy, inside 08:30–19:30 Central, with a realistic outcome mix;
 *   - tenant_appointments: a handful per day booked by the setters for the producers — earlier ones
 *     closed with mark_appointment_outcome, the last two days' left open for the close-out strip,
 *     and some later today and this week.
 * It never changes a lead's queue state or a work item, never sends anything, and inserts with
 * ON CONFLICT DO NOTHING. Every id is derived from "qa-d3:dash:<kind>:<date>:<n>", so a re-run the
 * same day adds only what has happened since, and --remove finds exactly these rows again.
 *
 *   node --env-file=.env.local scripts/seed-dashboard-recent.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-dashboard-recent.mjs
 *   node --env-file=.env.local scripts/seed-dashboard-recent.mjs --remove [--from=2026-10-01]
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const ZONE = "America/Chicago";
const DAYS = 14;
const DRY = process.argv.includes("--dry-run");
const REMOVE = process.argv.includes("--remove");
const FROM_ARG = process.argv.find((a) => a.startsWith("--from="))?.slice(7);
const NOW = Date.now();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (result, what) => { if (result.error) throw new Error(`${what}: ${result.error.message}`); return result.data; };

function uid(key) {
  const h = createHash("sha1").update(`qa-d3:dash:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
function rngFor(key) {
  let s = parseInt(createHash("sha1").update(key).digest("hex").slice(0, 8), 16) || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p, pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (pairs) => { const total = pairs.reduce((t, [, w]) => t + w, 0); let r = next() * total; for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs.at(-1)[0]; } };
}
/** The Central-time calendar date of an instant, and the UTC instant of a Central wall-clock time. */
function localDate(at) { return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
function atLocal(date, hh, mm) {
  const guess = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:00Z`);
  return guess - (shown - guess);
}
function dow(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
function slotOf(at, date) {
  if ([0, 6].includes(dow(date))) return "weekend";
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour12: false, hour: "2-digit" }).format(at));
  return h < 10 ? "early_morning" : h < 12 ? "late_morning" : h < 17 ? "afternoon" : h < 19 ? "early_evening" : "late_evening";
}
const STATE_TZ = { AZ: "America/Phoenix", CA: "America/Los_Angeles", NV: "America/Los_Angeles", WA: "America/Los_Angeles", OR: "America/Los_Angeles", CO: "America/Denver", UT: "America/Denver", NM: "America/Denver", TX: "America/Chicago", IL: "America/Chicago", OK: "America/Chicago", AL: "America/Chicago", MO: "America/Chicago", TN: "America/Chicago", WI: "America/Chicago", MN: "America/Chicago" };
const tzFor = (state) => STATE_TZ[state] ?? "America/New_York";

/** The dates in the window, oldest first, ending today (Central). */
function windowDates(fromDate) {
  const today = localDate(NOW);
  const out = [];
  for (let d = fromDate ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / DAY) : DAYS - 1; d >= 0; d -= 1) out.push(localDate(NOW - d * DAY));
  return [...new Set(out)];
}

// ── who dials ────────────────────────────────────────────────────────────────────────────────────
const members = must(await db.from("tenant_users").select("user_id, role, users(email, name)").eq("tenant_id", TENANT_ID), "read members");
const byEmail = new Map(members.map((m) => [m.users?.email, m]));
const AGENTS = [
  ["devin.okafor@qa-demo.insurvas.test", "producer", 1.15],
  ["marisol.vance@qa-demo.insurvas.test", "producer", 1.0],
  ["colin.reddy@qa-demo.insurvas.test", "producer", 0.8],
  ["jordan.pike@qa-demo.insurvas.test", "setter", 1.35],
  ["aaliyah.brooks@qa-demo.insurvas.test", "setter", 1.1],
  ["nadia.ferris@qa-demo.insurvas.test", "setter", 0.9],
  ["demo.agent@insurvas.test", "owner", 0.25],
].map(([email, kind, pace]) => ({ email, kind, pace, id: byEmail.get(email)?.user_id })).filter((a) => a.id);
if (AGENTS.length < 4) throw new Error(`expected the demo agents in ${TENANT_ID}; found ${AGENTS.length}`);
const PRODUCERS = AGENTS.filter((a) => a.kind === "producer");
const SETTERS = AGENTS.filter((a) => a.kind === "setter");

// ── the plan for one day (deterministic from the date alone, so --remove can rebuild the ids) ─────
const NON_CONTACT = [["no_answer", 46], ["voicemail", 22], ["call_dropped", 3]];
const CONTACT = { producer: [["not_interested", 12], ["callback_scheduled", 7], ["did_not_qualify", 4], ["application_submitted", 4], ["sent_to_underwriting", 1]], setter: [["not_interested", 13], ["callback_scheduled", 10], ["did_not_qualify", 4]], owner: [["not_interested", 10], ["callback_scheduled", 8], ["application_submitted", 3]] };
const HOURS = [[8, 3], [9, 9], [10, 13], [11, 12], [12, 6], [13, 9], [14, 12], [15, 12], [16, 10], [17, 7], [18, 5], [19, 2]];

function planDay(date) {
  const weekend = [0, 6].includes(dow(date));
  const dials = [];
  for (const agent of AGENTS) {
    const rng = rngFor(`day:${date}:${agent.email}`);
    if (weekend && (agent.kind !== "setter" || rng.chance(0.6))) continue;
    if (!weekend && rng.chance(0.07)) continue; // a day off now and then
    const base = agent.kind === "setter" ? rng.int(48, 86) : agent.kind === "producer" ? rng.int(30, 62) : rng.int(4, 12);
    const count = Math.round(base * agent.pace * (weekend ? 0.25 : 1));
    for (let i = 0; i < count; i += 1) {
      const hour = rng.weighted(HOURS);
      const at = atLocal(date, hour, hour === 8 ? rng.int(30, 59) : rng.int(0, 59)) + rng.int(0, 59) * 1000;
      const contact = rng.chance(agent.kind === "setter" ? 0.3 : 0.27);
      const disposition = rng.weighted(contact ? CONTACT[agent.kind] : NON_CONTACT);
      dials.push({ id: uid(`attempt:${date}:${agent.email}:${i}`), agent, at, disposition, clicked: !rng.chance(0.02), n: rng.int(1, 6), pick: rng.next() });
    }
  }
  const appts = [];
  const rng = rngFor(`appts:${date}`);
  const booked = weekend ? 0 : rng.int(3, 6);
  for (let i = 0; i < booked; i += 1) {
    const setter = rng.pick(SETTERS), producer = rng.pick(PRODUCERS);
    const startsAt = atLocal(date, rng.pick([9, 10, 11, 13, 14, 15, 16]), rng.pick([0, 30]));
    appts.push({ id: uid(`appointment:${date}:${i}`), setter, producer, startsAt, createdAt: startsAt - rng.int(1, 4) * DAY - rng.int(1, 6) * HOUR, outcome: rng.weighted([["showed", 62], ["no_show", 22], ["cancelled", 10], ["rescheduled", 6]]), pick: rng.next(),
      notes: rng.pick(["Wants to compare two term carriers; spouse joins the call.", "Budget about $40/month; prefers mornings.", "Mortgage protection; closing on a house next month.", "Retired teacher, asked about final expense and term.", "Has group coverage through work; wants something portable."]) });
  }
  return { dials, appts };
}

// ── remove ───────────────────────────────────────────────────────────────────────────────────────
const dates = windowDates(REMOVE ? (FROM_ARG ?? localDate(NOW - 30 * DAY)) : null);
if (REMOVE) {
  let attempts = 0, appts = 0;
  for (const date of dates) {
    const { dials, appts: planned } = planDay(date);
    for (let i = 0; i < dials.length; i += 400) {
      const ids = dials.slice(i, i + 400).map((d) => d.id);
      if (!DRY) must(await db.from("tenant_lead_activity").delete().eq("tenant_id", TENANT_ID).in("call_attempt_id", ids), "remove activity cards");
      const gone = DRY ? ids : must(await db.from("tenant_call_attempts").delete().eq("tenant_id", TENANT_ID).in("id", ids).select("id"), "remove attempts");
      attempts += gone.length;
    }
    const ids = planned.map((a) => a.id);
    if (ids.length) appts += (DRY ? ids : must(await db.from("tenant_appointments").delete().eq("tenant_id", TENANT_ID).in("id", ids).select("id"), "remove appointments")).length;
  }
  console.log(`${DRY ? "[dry run] would remove" : "removed"} ${attempts} dial(s) and ${appts} appointment(s) from ${dates[0]} to ${dates.at(-1)}`);
  process.exit(0);
}

// ── the leads they dial: tagged demo leads with a work item and no open callback ──────────────────
const leads = [];
for (let from = 0; ; from += 1000) {
  const page = must(await db.from("agent_leads").select("id, values").eq("tenant_id", TENANT_ID).eq("values->>qa_seed", "design2-outbound").order("id").range(from, from + 999), "read leads");
  leads.push(...page);
  if (page.length < 1000 || leads.length >= 4000) break;
}
const ids = leads.map((l) => l.id);
const work = new Map(), busy = new Set();
for (let i = 0; i < ids.length; i += 300) {
  const part = ids.slice(i, i + 300);
  for (const q of must(await db.from("lead_queue").select("id, lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part), "read work items")) work.set(q.lead_id, q.id);
  for (const c of must(await db.from("tenant_callbacks").select("lead_id").eq("tenant_id", TENANT_ID).in("status", ["scheduled", "due"]).in("lead_id", part), "read callbacks")) busy.add(c.lead_id);
}
const POOL = leads.filter((l) => work.has(l.id) && !busy.has(l.id)).map((l) => ({ id: l.id, workItemId: work.get(l.id), state: String(l.values?.state ?? "TX").toUpperCase() }));
if (POOL.length < 200) throw new Error(`only ${POOL.length} usable demo leads; run scripts/seed-demo-outbound.mjs first`);
const leadFor = (pick) => POOL[Math.floor(pick * POOL.length)];

// ── write ────────────────────────────────────────────────────────────────────────────────────────
let newDials = 0, keptDials = 0, newAppts = 0, keptAppts = 0, skippedAppts = 0, outcomes = 0;
for (const date of dates) {
  const { dials, appts } = planDay(date);
  const due = dials.filter((d) => d.at <= NOW - MIN);
  const rows = due.map((d) => {
    const lead = leadFor(d.pick);
    return { id: d.id, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: lead.workItemId, attempt_number: d.n, slot: slotOf(d.at, date), attempted_at: new Date(d.at).toISOString(), disposition: d.disposition, agent_id: d.agent.id, dial_clicked_at: d.clicked ? new Date(d.at + 3000).toISOString() : null, disclosure_state: lead.state, disclosure_confirmed_at: new Date(d.at + 500).toISOString() };
  });
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400);
    const inserted = DRY ? part : must(await db.from("tenant_call_attempts").upsert(part, { onConflict: "id", ignoreDuplicates: true }).select("id"), `insert dials ${date}`);
    newDials += inserted.length; keptDials += part.length - inserted.length;
  }

  for (const a of appts) {
    const lead = leadFor(a.pick);
    const row = { id: a.id, tenant_id: TENANT_ID, lead_id: lead.id, agent_user_id: a.producer.id, booked_by: a.setter.id, starts_at_utc: new Date(a.startsAt).toISOString(), duration_minutes: 30, buffer_minutes: 10, customer_timezone: tzFor(lead.state), status: "booked", notes: a.notes, created_at: new Date(Math.min(a.createdAt, NOW - HOUR)).toISOString(), seat: 1 };
    let inserted = [row];
    if (!DRY) {
      const result = await db.from("tenant_appointments").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("id");
      // The producer already has someone at that time: the database refuses a double booking, as it should.
      if (result.error?.code === "23P01") { skippedAppts += 1; continue; }
      inserted = must(result, `insert appointment ${date}`);
    }
    if (!inserted.length) { keptAppts += 1; continue; }
    newAppts += 1;
    // Ended more than two days ago: the producer has recorded the outcome. The last two days' stay
    // open, so the dashboard's close-out strip has something to close out; later ones are upcoming.
    const ended = a.startsAt + 30 * MIN < NOW;
    if (ended && a.startsAt < NOW - 2 * DAY && !DRY) {
      must(await db.rpc("mark_appointment_outcome", { p_tenant_id: TENANT_ID, p_appointment_id: a.id, p_actor: a.producer.id, p_outcome: a.outcome }), `outcome ${a.outcome}`);
      outcomes += 1;
    }
  }
}
console.log(`${DRY ? "[dry run] " : ""}${dates[0]} → ${dates.at(-1)}: dials ${newDials} new, ${keptDials} already there; appointments ${newAppts} new (${outcomes} closed with an outcome), ${keptAppts} already there, ${skippedAppts} skipped (producer already booked). Pool ${POOL.length} leads, ${AGENTS.length} agents.`);
