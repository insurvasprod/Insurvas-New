// Seed a baseline outbound disclosure for every state, so the dialer's disclosure gate can pass.
//
// Run with:  node --env-file=.env.local scripts/seed-state-disclosures.mjs
//            node --env-file=.env.local scripts/seed-state-disclosures.mjs --remove
//
// ── Read this before using it ──────────────────────────────────────────────
//
// The text below is NOT compliance-approved and is not legal advice. It is a serviceable skeleton
// of a standard outbound sales-call disclosure — identify the caller, state the purpose, note
// recording, offer the do-not-call opt-out — and nothing more. Real requirements vary by state and
// by product, and no per-state variation is attempted here.
//
// It therefore carries a marker as its first line. That marker is deliberate and it is the whole
// safety mechanism: the dialer shows this text to the agent to read aloud, so an unapproved
// disclosure that reached a live call would announce itself in the first breath rather than pass
// unnoticed. An embarrassing call is a better failure than a silent TCPA exposure.
//
// Replace it per state and product on /admin/state-disclosures, which edits in place and keeps the
// effective date. Withdrawing the last live row for a state re-blocks dialing there, by design.
//
// Telephony is not enabled in this environment, so nothing here is spoken to anyone today.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Matches lib/appointments/constants.ts — 50 states plus DC.
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// Every lead in this database carries product_line 'term_life', and the dialer falls back to the
// same value when a lead has none. Seeding product codes nobody sells would be inventing
// disclosures for business the agency does not write.
const PRODUCT = "term_life";

const MARKER = "[PLACEHOLDER — NOT COMPLIANCE-APPROVED. Replace on /admin/state-disclosures before any live call.]";

const TEXT = `${MARKER}

Hello, my name is ______ and I am a licensed insurance producer calling on behalf of ______.

This is a sales call about life insurance coverage.

This call may be recorded for quality assurance and training purposes.

If you would prefer not to receive calls like this, tell me now and I will add this number to our do-not-call list immediately and permanently.`;

const remove = process.argv.includes("--remove");
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const before = await db.from("state_disclosures").select("state", { count: "exact" }).eq("product_code", PRODUCT);
  if (before.error) throw new Error(`could not read existing disclosures: ${before.error.message}`);
  console.log(`existing ${PRODUCT} disclosures: ${before.data.length}`);

  if (remove) {
    const gone = await db.from("state_disclosures").delete().eq("product_code", PRODUCT).select("id");
    if (gone.error) throw new Error(`removal failed: ${gone.error.message}`);
    console.log(`removed ${gone.data.length} row(s). Dialing is blocked again for ${PRODUCT}.`);
    return;
  }

  // Refuses rather than silently overwriting anything that is not this placeholder. If somebody has
  // published real approved wording, a re-run of a seed script must not quietly replace it.
  const approved = before.data.length
    ? await db.from("state_disclosures").select("state, required_text").eq("product_code", PRODUCT)
    : { data: [] };
  const real = (approved.data ?? []).filter((row) => !String(row.required_text).startsWith("[PLACEHOLDER"));
  if (real.length) {
    console.error(`REFUSING: ${real.length} state(s) already hold non-placeholder text (${real.map((r) => r.state).join(", ")}).`);
    console.error("Edit those on /admin/state-disclosures instead of re-running this seed.");
    process.exit(1);
  }

  const rows = STATES.map((state) => ({
    state,
    product_code: PRODUCT,
    required_text: TEXT,
    effective_from: today,
  }));

  // The same upsert the publisher uses: (state, product_code, effective_from) is the unique key, so
  // re-running on the same day corrects wording rather than failing on a constraint.
  const written = await db
    .from("state_disclosures")
    .upsert(rows, { onConflict: "state,product_code,effective_from" })
    .select("state");
  if (written.error) throw new Error(`seed failed: ${written.error.message}`);
  console.log(`published ${written.data.length} state(s) for ${PRODUCT}, effective ${today}`);

  // Proof rather than assumption: ask the exact query the dialer runs, for a state a lead is in.
  for (const state of ["TX", "FL", "AZ", "GA"]) {
    const seen = await db
      .from("state_disclosures")
      .select("required_text, effective_from")
      .eq("state", state)
      .eq("product_code", PRODUCT)
      .lte("effective_from", today)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    console.log(`  dialer lookup ${state}/${PRODUCT}: ${seen.data ? "found" : "NOTHING — still blocked"}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
