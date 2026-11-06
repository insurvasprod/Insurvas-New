// One-off demo load for the Ellery & Fields demo agency (owner approved 2026-11-06: "Yes, load demo data").
// Every row is tagged: leads carry values.qa_seed = TAG; every id written is logged to the JSON file given as argv[3].
// Usage: node --env-file=.env.local scripts/_seed_dashboard_demo.mjs one|all <log.json>
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const MODE = process.argv[2];
const LOG = process.argv[3];
if (!["one", "all"].includes(MODE) || !LOG) throw new Error("usage: one|all <log.json>");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const T = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const TAG = "dash-demo-2026-11-06";

const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { tag: TAG, rows: [] };
const save = () => writeFileSync(LOG, JSON.stringify(log, null, 1));
if (MODE === "all" && log.rows.some((row) => row.table === "agent_leads" && row.bulk)) throw new Error("already loaded: see " + LOG);

// The pieces the demo agency already uses (read from one of its own issued sales).
const TEMPLATE = { template_id: "fff9c3ac-7354-4aa5-8f6c-aa717e0d9257", template_version: 1, definition_version: 1, pipeline_id: "9eb3a2b4-e0dc-4f29-9512-9d758cf061c9", stage_id: "730e69d9-ebf9-4173-b205-748773712c17" };
const QUOTE_TEMPLATE = "5110c076-f33d-44cc-8a50-2a15e25a4835";
const P = {
  devin: "606071d8-23e4-4367-a014-405aa7f0582d",
  marisol: "8f480c9c-0535-4a05-859c-b3ee0cafd961",
  demo: "1a01e923-c071-422d-96dd-08ff23e23075",
  leah: "01079f85-960a-479c-9954-3ab078748da2",
};
const CARRIERS = [
  ["5bd2ff41-fd83-485e-9373-9ada7a0aa3c7", "American Amicable"],
  ["4e51b621-7505-4c38-b48e-dd1bb1fab22c", "Americo"],
  ["5cefe920-e902-48e1-868e-741b095a95de", "Mutual of Omaha"],
  ["47307eb5-04fe-44f5-9ce5-d2f971879253", "Aflac"],
  ["030ec793-dcbb-4208-9725-e840409d433c", "American Home Life"],
  ["4143cb98-4d3e-4adf-a00d-e9e9f2d534a8", "Corebridge Financial"],
];
const STATES = ["TX", "TX", "TX", "FL", "FL", "OH", "OH", "GA", "GA", "NC", "AZ", "TN", "PA", "MI", "IL"];
const PRODUCTS = ["term_life", "final_expense", "whole_life", "iul"];
const FIRST = ["Brenda", "Luis", "Grace", "Paul", "June", "Karen", "Ray", "Nina", "Omar", "Tessa", "Victor", "Alma", "Dale", "Rosa", "Hank", "Iris", "Calvin", "Mabel", "Ernest", "Lydia", "Gordon", "Paula", "Wade", "Fern"];
const LAST = ["Kim", "Ortega", "Lin", "Whitaker", "Park", "Davis", "Coleman", "Hale", "Barnes", "Reyes", "Pruitt", "Lowell", "Mercer", "Quinn", "Albright", "Fenwick", "Garrow", "Holt", "Ingram", "Juarez", "Kessler", "Lomax", "Marsh", "Nolan"];

// A seeded generator, so a rerun of "one" gives the same shapes.
let s = 20261106;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (lo, hi) => Math.round(lo + rnd() * (hi - lo));
const at = (day, hour = between(14, 21), minute = between(0, 59)) => new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`).toISOString();
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
let policySeq = between(1000, 4000);

async function insert(table, row, extra = {}) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message} ${error.details ?? ""} ${error.hint ?? ""}`);
  log.rows.push({ table, id: data.id, ...extra });
  return data.id;
}
async function update(table, id, patch) {
  const { error } = await db.from(table).update(patch).eq("id", id).eq("tenant_id", T);
  if (error) throw new Error(`${table} update: ${error.message} ${error.details ?? ""}`);
}

async function lead({ day, called, bulk }) {
  const first = pick(FIRST);
  const last = pick(LAST);
  const state = pick(STATES);
  const phone = `5125${String(between(100000, 999999))}`;
  const created = at(day, between(13, 18));
  return insert("agent_leads", {
    tenant_id: T, ...TEMPLATE, stage_key: "new", product_line: "term_life",
    values: { first_name: first, last_name: last, state, st: state, phone, email: `${first}.${last}${between(10, 99)}@example.org`.toLowerCase(), qa_seed: TAG, date_of_birth: `19${between(48, 79)}-0${between(1, 9)}-1${between(0, 9)}` },
    created_at: created, posted_at: created,
    first_dial_at: called ? new Date(Date.parse(created) + between(3, 40) * 60_000).toISOString() : null,
    attempts_made: called ? between(1, 3) : 0,
    lead_state: called ? "retry" : "fresh",
    screening_outcome: "clear",
  }, { bulk, name: `${first} ${last}`, state });
}

/** A whole sale: lead → case → quote → (application → deal → issued policy). stage: quoted | submitted | pending | issued. */
async function sale({ day, producer, stage, monthly, bulk }) {
  const leadId = await lead({ day: addDays(day, -between(2, 9)), called: true, bulk });
  const [carrierId, carrierName] = pick(CARRIERS);
  const product = pick(PRODUCTS);
  const face = between(10, 250) * 1000 * 100;
  const opened = at(addDays(day, -between(1, 6)));
  const caseId = await insert("tenant_application_cases", { tenant_id: T, lead_id: leadId, product_line: product === "iul" ? "term_life" : product, source: "outbound", status: stage === "issued" ? "won" : "open", opened_by: producer, opened_at: opened, ...(stage === "issued" ? { closed_at: at(day) } : {}) });
  const quoteId = await insert("tenant_quotes", {
    tenant_id: T, case_id: caseId, lead_id: leadId, insured_role: "primary", carrier_id: carrierId, product_code: product, quotation_template_id: QUOTE_TEMPLATE, template_revision: 1,
    tier: "level", face_amount_cents: face, monthly_premium_cents: monthly, annual_premium_cents: monthly * 12, age_used: between(45, 75), term_length: product === "term_life" ? 20 : null,
    assumed_health_class: "Standard", rating_inputs: { tier: "level", face_amount: face }, riders: [], warnings: [], status: stage === "quoted" ? "presented" : "selected", created_by: producer, created_at: opened,
  });
  if (stage === "quoted") return;
  const submitted = at(addDays(day, stage === "issued" ? -between(2, 6) : 0));
  const status = stage === "issued" ? "closed" : stage === "pending" ? "pending_carrier" : "submitted";
  const appId = await insert("tenant_applications", {
    tenant_id: T, case_id: caseId, lead_id: leadId, insured_role: "primary", attempt_no: 1, carrier_id: carrierId, product_code: product, quote_id: quoteId,
    status, outcome: stage === "issued" ? "issued" : null, created_by: producer, created_at: opened, submitted_at: submitted,
    ...(stage === "issued" ? { outcome_recorded_at: at(day), closed_at: at(day) } : {}),
  });
  await update("tenant_quotes", quoteId, { application_id: appId });
  // The Applications list dates a row by updated_at: an issued sale's is the day it was issued.
  await update("tenant_applications", appId, { updated_at: stage === "issued" ? at(day) : submitted });
  const lv = log.rows.find((row) => row.id === leadId);
  const dealId = await insert("deal_flow", {
    tenant_id: T, lead_id: leadId, product_line: product === "iul" ? "term_life" : product, stage_key: "new", pipeline_id: TEMPLATE.pipeline_id, stage_id: TEMPLATE.stage_id,
    insured_name: lv.name, phone: "5125550100", initial_quote: `${carrierName} · $${(face / 100).toLocaleString("en-US")} face · $${(monthly / 100).toFixed(2)}/mo`,
    local_date: day, call_result: "application_submitted", status: "completed", carrier: carrierName, product_type: product, monthly_premium_cents: monthly, face_amount_cents: face,
    worked_by: producer, manual_entry: false, source: "outbound", notes: `Demo seed ${TAG}`, created_at: opened,
  });
  if (stage !== "issued") return;
  policySeq += 1;
  await insert("tenant_issued_policies", {
    tenant_id: T, lead_id: leadId, application_case_id: caseId, deal_id: dealId, application_id: appId, product_line: product === "iul" ? "term_life" : product,
    carrier: carrierName, policy_number: `DD26${String(policySeq).padStart(6, "0")}`, status: "issued", issued_at: `${day}T00:00:00+00:00`,
  });
}

async function attempts(day, producer, total, contacts) {
  const leads = log.rows.filter((row) => row.table === "agent_leads").map((row) => row.id);
  for (let i = 0; i < total; i += 1) {
    const contact = i < contacts;
    const when = at(day, between(13, 20));
    await insert("tenant_call_attempts", {
      tenant_id: T, lead_id: pick(leads), attempt_number: 1, slot: "afternoon", attempted_at: when, dial_clicked_at: when, agent_id: producer,
      disposition: contact ? pick(["callback_scheduled", "callback_scheduled", "application_submitted", "not_interested"]) : pick(["no_answer", "no_answer", "voicemail", "busy"]),
    });
  }
}

const NOV = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
const novDay = () => pick(NOV);
try {
  if (MODE === "one") {
    await sale({ day: "2026-11-05", producer: P.devin, stage: "issued", monthly: 24800, bulk: false });
  } else {
    // November so far: each producer near 80% of October (Leah's first month).
    const plan = [[P.devin, 27, 21000, 32000], [P.marisol, 14, 17000, 26000], [P.demo, 9, 15000, 22000], [P.leah, 6, 9000, 18000]];
    for (const [producer, count, lo, hi] of plan) for (let i = 0; i < count; i += 1) await sale({ day: novDay(), producer, stage: "issued", monthly: between(lo, hi), bulk: true });
    // Today's sales (ahead of the average) and the rest of the month's pipeline.
    for (let i = 0; i < 6; i += 1) await sale({ day: "2026-11-06", producer: pick([P.demo, P.devin, P.marisol]), stage: "submitted", monthly: between(6000, 18000), bulk: true });
    for (let i = 0; i < 12; i += 1) await sale({ day: novDay(), producer: pick(Object.values(P)), stage: "submitted", monthly: between(6000, 18000), bulk: true });
    for (let i = 0; i < 6; i += 1) await sale({ day: novDay(), producer: pick(Object.values(P)), stage: "pending", monthly: between(6000, 18000), bulk: true });
    for (let i = 0; i < 40; i += 1) await sale({ day: novDay(), producer: pick(Object.values(P)), stage: "quoted", monthly: between(5000, 16000), bulk: true });
    // November's other leads: most of them called.
    for (let i = 0; i < 140; i += 1) await lead({ day: novDay(), called: rnd() < 0.78, bulk: true });
    // February to September: a growing year of issued sales, so "submitted" has a history.
    const months = [["02", 5], ["03", 6], ["04", 7], ["05", 8], ["06", 9], ["07", 10], ["08", 11], ["09", 12]];
    for (const [mm, count] of months) for (let i = 0; i < count; i += 1) await sale({ day: `2026-${mm}-${String(between(3, 27)).padStart(2, "0")}`, producer: pick(Object.values(P)), stage: "issued", monthly: between(7000, 20000), bulk: true });
    // Today on the phone, and the days before it, for the Demo Agent.
    await attempts("2026-11-06", P.demo, 72, 26);
    for (const [day, total, contacts] of [["2026-11-05", 58, 19], ["2026-11-04", 61, 21], ["2026-11-03", 49, 15], ["2026-11-02", 44, 13]]) await attempts(day, P.demo, total, contacts);
  }
  save();
  console.log("done", log.rows.length, "rows written");
} catch (error) {
  save();
  console.error("STOPPED:", error.message, "| rows written so far:", log.rows.length);
  process.exitCode = 1;
}
