// Test data: a lead with a SUBMITTED American Amicable application, ready for the carrier's policy file to
// auto-link (ladder step 2: application number = policy number, surname + date of birth agree), then commissions.
//
// It copies a template case that was walked through the app end to end (Quinn Testmore, 2026-11-03: lead,
// work item, case, interview, quote, application, its values, beneficiary, payment, disclosures, submission,
// sale) into a new lead with a new name, date of birth and application number. Every id is new; ids inside a
// copied row that point at another copied row are remapped. The SSN is not copied (it is encrypted to its own
// application), so the copy has none — it is already submitted, so nothing asks for it.
//
//   node --env-file=.env.local scripts/seed-submitted-application.mjs --first Nora --last Testwell --dob 1958-04-12 --policy 0119990020
//
// Writes to the tenant of the template only (Ellery & Fields demo). Prints what it made; changes nothing else.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const first = arg("first"), last = arg("last"), dob = arg("dob"), policy = arg("policy");
if (!first || !last || !/^\d{4}-\d\d-\d\d$/.test(dob ?? "") || !/^\d{6,20}$/.test(policy ?? "")) {
  console.error("Usage: --first <name> --last <name> --dob YYYY-MM-DD --policy <application number>"); process.exit(1);
}
const TEMPLATE = { lead: "d6b59950-f954-426b-a032-20b353155f41", case: "b0de71bd-72bd-4d90-93ea-d4bb3e13323f", application: "91fbc555-65c3-417e-9d85-dc3f3a225013" };
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data ?? []; };

const remap = new Map();
const newId = (old) => { if (!remap.has(old)) remap.set(old, randomUUID()); return remap.get(old); };
const now = new Date().toISOString();
const NAME_KEYS = { first_name: first, last_name: last, firstname: first, lastname: last };
const DOB_KEYS = ["dob", "date_of_birth", "birth_date"];

/** A copy of a row: a new id, every copied id remapped, the person's name and birth date replaced. */
function copyOf(row, extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") out.id = newId(value);
    else if (typeof value === "string" && remap.has(value)) out[key] = remap.get(value);
    else if (key in NAME_KEYS) out[key] = NAME_KEYS[key];
    else if (DOB_KEYS.includes(key) && value) out[key] = dob;
    else if (/^(full_name|customer_name|client_name|lead_name|name)$/.test(key) && typeof value === "string" && /testmore/i.test(value)) out[key] = `${first} ${last}`;
    else out[key] = value;
  }
  return { ...out, ...extra };
}

async function copy(table, rows, extra = (row) => ({})) {
  if (!rows.length) return [];
  const made = rows.map((row) => copyOf(row, extra(row)));
  must(await db.from(table).insert(made), `insert ${table}`);
  console.log(`  ${table}: ${made.length}`);
  return made;
}

// Read the template first, so every id it has is known before anything is written.
const lead = must(await db.from("agent_leads").select("*").eq("id", TEMPLATE.lead), "lead")[0];
const kase = must(await db.from("tenant_application_cases").select("*").eq("id", TEMPLATE.case), "case")[0];
const app = must(await db.from("tenant_applications").select("*").eq("id", TEMPLATE.application), "application")[0];
if (!lead || !kase || !app) throw new Error("The template case is not there any more.");
const [queue, quotes, interviews, values, beneficiaries, payments, disclosures, submissions, deals] = await Promise.all([
  db.from("lead_queue").select("*").eq("lead_id", lead.id),
  db.from("tenant_quotes").select("*").eq("case_id", kase.id),
  db.from("tenant_uw_interviews").select("*").eq("case_id", kase.id),
  db.from("tenant_application_values").select("*").eq("application_id", app.id).neq("field_key", "insured.ssn"),
  db.from("tenant_application_beneficiaries").select("*").eq("application_id", app.id),
  db.from("tenant_application_payment_methods").select("*").eq("application_id", app.id),
  db.from("tenant_application_disclosures").select("*").eq("application_id", app.id),
  db.from("tenant_application_submissions").select("*").eq("application_id", app.id),
  db.from("deal_flow").select("*").eq("lead_id", lead.id),
]).then((reads) => reads.map((r, i) => must(r, `read ${i}`)));
// Every id of the case is new, decided up front so references between rows land on the copies.
for (const row of [lead, kase, app, ...queue, ...quotes, ...interviews, ...values, ...beneficiaries, ...payments, ...disclosures, ...submissions, ...deals]) if (row.id) newId(row.id);

console.log(`Making ${first} ${last} (born ${dob}), application number ${policy}:`);
const stamp = (row) => ({ ...("created_at" in row ? { created_at: now } : {}), ...("updated_at" in row ? { updated_at: now } : {}) });

// A run that stopped part way left this person's lead, work item, case and interview: carry on with those
// instead of making a second lead (2026-11-03: the first run stopped at the quote).
// The lead keeps the person in `values`: a copy carries this person, and the age their birth date gives.
const age = Math.floor((Date.now() - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * 86_400_000));
const leadValues = { ...(lead.values ?? {}), first_name: first, last_name: last, date_of_birth: dob, age };
// The first version of this script left the template's name in a copy's `values`: such a copy (made in the
// last two days, still named as the template) is the earlier lead too.
const sameName = must(await db.from("agent_leads").select("id").eq("tenant_id", lead.tenant_id).eq("values->>first_name", first).eq("values->>last_name", last).neq("id", lead.id).order("created_at", { ascending: false }).limit(1), "earlier lead");
const unnamed = sameName.length ? [] : must(await db.from("agent_leads").select("id").eq("tenant_id", lead.tenant_id).eq("values->>last_name", lead.values?.last_name ?? "").neq("id", lead.id).gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1), "earlier unnamed lead");
const earlier = sameName[0] ?? unnamed[0];
const earlierCase = earlier ? must(await db.from("tenant_application_cases").select("id").eq("lead_id", earlier.id).limit(1), "earlier case")[0] : null;
if (earlier && earlierCase && must(await db.from("tenant_applications").select("id").eq("case_id", earlierCase.id).limit(1), "earlier application").length) {
  console.error(`${first} ${last} already has an application (lead ${earlier.id}). Use another name.`); process.exit(1);
}
if (earlier) {
  console.log(`  carrying on with the lead made earlier: ${earlier.id}`);
  remap.set(lead.id, earlier.id);
  must(await db.from("agent_leads").update({ values: leadValues }).eq("id", earlier.id), "name the earlier lead");
  if (earlierCase) remap.set(kase.id, earlierCase.id);
  const earlierInterviews = earlierCase ? must(await db.from("tenant_uw_interviews").select("id").eq("case_id", earlierCase.id), "earlier interviews") : [];
  interviews.forEach((row, i) => { if (earlierInterviews[i]) remap.set(row.id, earlierInterviews[i].id); });
  const hasQueue = must(await db.from("lead_queue").select("id").eq("lead_id", earlier.id).limit(1), "earlier work item").length > 0;
  if (!hasQueue) await copy("lead_queue", queue, stamp);
  if (!earlierCase) await copy("tenant_application_cases", [kase], stamp);
  if (earlierCase && !earlierInterviews.length) await copy("tenant_uw_interviews", interviews, stamp);
  if (!earlierCase) await copy("tenant_uw_interviews", interviews, stamp);
} else {
  await copy("agent_leads", [lead], (row) => ({ ...stamp(row), values: leadValues }));
  await copy("lead_queue", queue, stamp);
  await copy("tenant_application_cases", [kase], stamp);
  await copy("tenant_uw_interviews", interviews, stamp);
}
// The application and its quote point at each other: the application goes in without its quote, then the
// quote, then the application is given it.
const [madeApp] = await copy("tenant_applications", [app], (row) => ({ ...stamp(row), submitted_at: now, quote_id: null }));
await copy("tenant_quotes", quotes, stamp);
if (app.quote_id) must(await db.from("tenant_applications").update({ quote_id: remap.get(app.quote_id) ?? null }).eq("id", madeApp.id), "set the application's quote");
const person = { "insured.first_name": first, "insured.last_name": last, "insured.dob": dob };
await copy("tenant_application_values", values, (row) => ({ ...stamp(row), ...(row.field_key in person ? { value: person[row.field_key] } : {}) }));
await copy("tenant_application_beneficiaries", beneficiaries, stamp);
await copy("tenant_application_payment_methods", payments, stamp);
await copy("tenant_application_disclosures", disclosures, stamp);
await copy("tenant_application_submissions", submissions, (row) => ({ ...stamp(row), carrier_reference: policy, reference_kind: "application_no", policy_number: null, submitted_at: now, confirmation_path: null }));
await copy("deal_flow", deals, (row) => ({ ...stamp(row), ...("customer_name" in row ? { customer_name: `${first} ${last}` } : {}) }));
console.log(`Done. Lead ${remap.get(lead.id)} · application ${remap.get(app.id)} · submitted with application number ${policy}.`);
