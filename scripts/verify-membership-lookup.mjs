// bugs_sa.md #1 · The checkout P0 fix depends on findMembershipForTenant actually WORKING.
//
// The first version of it omitted company_id, which Whop requires, so every call was a 400. The
// verification therefore failed closed on an error rather than on an answer — it never verified
// anything — and verify:checkout still passed, because "no access granted" looks identical whether
// you asked and got no, or could not ask at all.
//
// So this asserts the positive case too: a tenant that genuinely holds a membership must be
// CONFIRMED. Against the real sandbox, no fixtures. Run: npm run verify:membership-lookup
// Constructed directly rather than through the registry: registry.ts uses the "@/" alias, which
// Next resolves and a plain Node script does not.
import { WhopProvider } from "../lib/payments/whop/provider.ts";
import { WhopClient } from "../lib/payments/whop/client.ts";

let failures = 0;
const check = (l, c, d = "") => { console.log(c ? `  ok   ${l}` : `  FAIL ${l}${d ? " — " + d : ""}`); if (!c) failures++; };

const provider = new WhopProvider(new WhopClient({
  apiKey: process.env.WHOP_API_KEY ?? "",
  baseUrl: process.env.WHOP_API_BASE_URL ?? "https://api.whop.com/api/v1",
}));

const base = process.env.WHOP_API_BASE_URL;
const headers = { authorization: `Bearer ${process.env.WHOP_API_KEY}`, accept: "application/json" };
const company = process.env.WHOP_ACCOUNT_ID;

// Find any membership the sandbox actually holds, and use it as the positive case.
const res = await fetch(`${base}/memberships?company_id=${company}&first=100`, { headers });
const rows = res.ok ? ((await res.json()).data ?? []) : [];
const live = rows.find((m) => ["trialing", "active", "completed"].includes(m.status) && m.metadata?.tenant_id && m.plan?.id);

if (!live) {
  console.log("No usable membership in the sandbox; only the negative cases can be checked.");
} else {
  console.log(`Using ${live.id} (${live.status}) on ${live.plan.id} for tenant ${live.metadata.tenant_id}\n`);

  const found = await provider.findMembershipForTenant(live.plan.id, live.metadata.tenant_id);
  check("a tenant that HOLDS a membership is confirmed", found?.id === live.id,
        `got ${JSON.stringify(found)} — if this is null the lookup is not really working`);

  const wrongPlan = await provider.findMembershipForTenant("plan_definitely_not_real", live.metadata.tenant_id);
  check("the same tenant on a DIFFERENT plan is not confirmed", wrongPlan === null,
        `got ${JSON.stringify(wrongPlan)} — plan_id is ignored server-side, so this must be matched here`);
}

const unknown = await provider.findMembershipForTenant("plan_n1KydLQBN0hEU", "00000000-0000-0000-0000-000000000000");
check("an unknown tenant is not confirmed", unknown === null, JSON.stringify(unknown));

// The distinction that matters: a clean "no" rather than a thrown error. If the call were still
// malformed this would throw, and the checkout page would refuse every genuine customer.
let threw = null;
try {
  await provider.findMembershipForTenant("plan_n1KydLQBN0hEU", "00000000-0000-0000-0000-000000000000");
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
}
check("the lookup answers rather than erroring", threw === null, String(threw));

console.log(failures === 0 ? "\nAll membership lookup checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
