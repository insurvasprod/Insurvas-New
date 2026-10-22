// AG-1.10 · fill a DEMO agency's onboarding checklists so its producers can submit, the way a person would on the
// Producers screen: the same RPC (set_producer_carrier) and the same upserts the app's stores make. Repeatable —
// a second run adds nothing. Only the tenant passed in is touched.
//
//   node --env-file=.env.local scripts/agency/seed-demo-onboarding.mjs --tenant <id> [--dry]
//
// The owner: a level and a writing number for every carrier the agency is appointed with, from the agency's own
// carrier settings (tenant_carriers). Each other active producer: appointments with up to three carriers the
// agency is appointed with in his licensed states, his level (85% of the agency's), a DEMO- writing number,
// contracting, E&O (with expiry) and W-9 — the two documents are small sample PDFs saying so.
import { createClient } from "@supabase/supabase-js";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : process.argv[i + 1]; };
const TENANT = arg("tenant");
const DRY = process.argv.includes("--dry");
if (!TENANT) { console.error("Pass --tenant <id>."); process.exit(2); }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = async (q, what) => { const { data, error } = await q; if (error) throw new Error(`${what}: ${error.message}`); return data; };
const today = new Date().toISOString().slice(0, 10);
const inAYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

const { data: audience } = await sb.rpc("tenant_plan_audience", { p_tenant_id: TENANT });
if (audience !== "agency") { console.error(`Tenant ${TENANT} is not on an agency plan (${audience}); nothing to do.`); process.exit(2); }
const tenant = await must(sb.from("tenants").select("name").eq("id", TENANT).single(), "tenant");
const ownerUser = await must(sb.rpc("tenant_owner_user", { p_tenant_id: TENANT }), "owner");
console.log(`${DRY ? "[dry] " : ""}Filling onboarding for ${tenant.name}`);

const producers = await must(sb.from("producer").select("id, user_id, display_name, status").eq("tenant_id", TENANT), "producers");
const carriers = await must(sb.from("tenant_carriers").select("carrier_id, contract_level_bp, writing_number, effective_from, carriers(name)").eq("tenant_id", TENANT).lte("effective_from", today).order("effective_from", { ascending: false }), "carriers");
const agencyCarrier = new Map();
for (const c of carriers) if (!agencyCarrier.has(c.carrier_id)) agencyCarrier.set(c.carrier_id, c); // latest in force
const appointments = (await must(sb.from("appointments").select("carrier_id, state, status, expires_at, terminated_at").eq("tenant_id", TENANT), "appointments"))
  .filter((a) => a.status === "active" && (!a.expires_at || a.expires_at >= today) && (!a.terminated_at || a.terminated_at >= today));
const short = (name) => (name ?? "CAR").replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").toUpperCase();

async function setCarrier(producer, carrierId, levelBps, writingNumber, effectiveFrom) {
  const inForce = await must(sb.from("producer_writing_number").select("writing_number").eq("producer_id", producer.id).eq("carrier_id", carrierId).lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`), "numbers");
  const level = await must(sb.from("producer_contract_level").select("level_bps").eq("producer_id", producer.id).eq("carrier_id", carrierId).lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`), "levels");
  if (inForce.length && level.length) return "kept";
  if (DRY) return "would set";
  const { error } = await sb.rpc("set_producer_carrier", { p_tenant_id: TENANT, p_producer_id: producer.id, p_carrier_id: carrierId, p_level_bps: levelBps, p_writing_number: writingNumber, p_effective_from: effectiveFrom, p_actor: ownerUser });
  if (error) throw new Error(`set_producer_carrier ${producer.display_name}: ${error.message}`);
  return "set";
}

function samplePdf(title) {
  const text = `${title} - SAMPLE DOCUMENT FOR THE DEMO AGENCY - not a real certificate`;
  const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const at = body.length; body += `${index + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

async function completeItem(producer, item, expiresOn) {
  const existing = await must(sb.from("producer_onboarding_item").select("item, document_path, expires_on").eq("producer_id", producer.id).eq("item", item).maybeSingle(), "item");
  if (existing && (item === "contracting" || (existing.document_path && (item !== "eo" || existing.expires_on >= today)))) return "kept";
  if (DRY) return "would record";
  let documentPath = null;
  if (item !== "contracting") {
    documentPath = `${TENANT}/${producer.id}/${item}-${crypto.randomUUID()}.pdf`;
    const { error } = await sb.storage.from("agency-documents").upload(documentPath, samplePdf(item === "eo" ? "E&O certificate" : "W-9"), { contentType: "application/pdf", upsert: false });
    if (error) throw new Error(`upload ${item}: ${error.message}`);
  }
  await must(sb.from("producer_onboarding_item").upsert({ tenant_id: TENANT, producer_id: producer.id, item, completed_at: new Date().toISOString(), completed_by: ownerUser, expires_on: expiresOn, document_path: documentPath }, { onConflict: "producer_id,item" }), `item ${item}`);
  return "recorded";
}

for (const producer of producers.filter((p) => ["active", "onboarding"].includes(p.status))) {
  const isOwner = producer.user_id === ownerUser;
  console.log(`\n${producer.display_name}${isOwner ? " (owner)" : ""}`);
  if (isOwner) {
    for (const carrierId of [...new Set(appointments.map((a) => a.carrier_id))]) {
      const agency = agencyCarrier.get(carrierId);
      if (!agency?.contract_level_bp) { console.log(`  skip ${carrierId}: the agency has no level for it`); continue; }
      const number = agency.writing_number ?? `DEMO-OWN-${short(agency.carriers?.name)}`;
      console.log(`  ${agency.carriers?.name}: ${await setCarrier(producer, carrierId, agency.contract_level_bp, number, agency.effective_from)}`);
    }
  } else {
    const licensed = (await must(sb.from("tenant_user_licensed_states").select("state, expires_on").eq("tenant_id", TENANT).eq("user_id", producer.user_id), "licences"))
      .filter((l) => l.expires_on && l.expires_on >= today).map((l) => l.state);
    const offered = appointments.filter((a) => licensed.includes(a.state) && agencyCarrier.get(a.carrier_id)?.contract_level_bp);
    const chosen = [...new Set(offered.map((a) => a.carrier_id))].slice(0, 3);
    if (!chosen.length) console.log(`  no carrier the agency is appointed with in his licensed states (${licensed.join(", ") || "none"})`);
    for (const carrierId of chosen) {
      const agency = agencyCarrier.get(carrierId);
      for (const a of offered.filter((x) => x.carrier_id === carrierId)) {
        if (!DRY) await must(sb.from("producer_appointment").upsert({ tenant_id: TENANT, agency_id: (await must(sb.from("producer").select("agency_id").eq("id", producer.id).single(), "agency")).agency_id, producer_id: producer.id, carrier_id: carrierId, state: a.state, status: "appointed", effective_from: "2026-10-01", expires_on: null, updated_by: ownerUser, updated_at: new Date().toISOString() }, { onConflict: "producer_id,carrier_id,state" }), "appointment");
      }
      const level = Math.round((agency.contract_level_bp * 0.85) / 50) * 50;
      const number = `DEMO-${initials(producer.display_name)}-${short(agency.carriers?.name)}`;
      console.log(`  ${agency.carriers?.name} in ${offered.filter((x) => x.carrier_id === carrierId).map((x) => x.state).join(", ")}: level ${level / 100}% · ${await setCarrier(producer, carrierId, level, number, "2026-10-01")}`);
    }
    console.log(`  contracting: ${await completeItem(producer, "contracting", null)}`);
    console.log(`  E&O: ${await completeItem(producer, "eo", inAYear)}`);
    console.log(`  W-9: ${await completeItem(producer, "w9", null)}`);
  }
  if (!DRY) {
    const { data: ok, error } = await sb.rpc("producer_refresh_can_submit", { p_tenant_id: TENANT, p_producer_id: producer.id });
    if (error) throw new Error(`refresh: ${error.message}`);
    const { data: row } = await sb.from("producer").select("can_submit, can_submit_reason").eq("id", producer.id).single();
    console.log(`  can submit: ${ok ? "YES" : `no — ${row?.can_submit_reason}`}`);
  }
}
