import "./lib/refuseProduction.mjs";
// Verifies the public-endpoint rate limits added after the SA-5.1 review.
//
// The HTTP half deliberately uses a plan code that does not exist: the limiter runs BEFORE the
// plan lookup, so requests are counted and then rejected downstream — proving the wiring without
// creating a single tenant, user or email.
//
// Needs the app running. Run with: npm run verify:ratelimit
//
// The ceiling is IMPORTED from the application rather than written here as a number. It used to be
// hard-coded as "the sixth and seventh are refused", which silently became wrong the moment
// SIGNUP_PER_IP.max moved from 5 to 10 — the suite then failed while the limiter was working
// perfectly, because seven requests no longer reach a ceiling of ten. A rate-limit verifier that
// has to be edited whenever the rate limit changes is a verifier that will be edited to match
// whatever the code does, which is the opposite of a check.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Read from source rather than imported: `lib/rateLimit/index.ts` uses `@/` path aliases, which
// Node cannot resolve outside the bundler. Parsing the literal keeps the single source of truth
// without dragging the whole module graph into a standalone script.
function ruleMax(name) {
  const source = readFileSync(new URL(`../lib/rateLimit/index.ts`, import.meta.url), "utf8");
  const match = source.match(new RegExp(String.raw`export const ${name}\b[^=]*=[^{]*\{[^}]*max:\s*(\d+)`));
  if (!match) throw new Error(`could not read ${name}.max from lib/rateLimit/index.ts`);
  return Number(match[1]);
}

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const keys = [];

async function cleanup() {
  for (const key of keys) await supabase.from("rate_limits").delete().like("bucket_key", `%${key}%`);
  await supabase.from("rate_limits").delete().like("bucket_key", `%${stamp}%`);
}

try {
  console.log("The counter itself\n");

  const key = `test_${stamp}`;
  keys.push(key);
  const results = [];
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase.rpc("claim_rate_limit", { p_key: key, p_max: 3, p_window_seconds: 3600 });
    results.push(data);
  }

  check(
    "the first three are allowed and the fourth is refused",
    results[0] === true && results[1] === true && results[2] === true && results[3] === false,
    `got ${results.join(", ")}`,
  );

  // The check and the increment are one statement, so concurrent callers cannot both take the
  // last slot — which is exactly the burst a limiter exists to stop.
  const burstKey = `burst_${stamp}`;
  keys.push(burstKey);
  const burst = await Promise.all(
    Array.from({ length: 10 }, () =>
      supabase.rpc("claim_rate_limit", { p_key: burstKey, p_max: 3, p_window_seconds: 3600 }),
    ),
  );
  const allowed = burst.filter((r) => r.data === true).length;
  check(
    "ten concurrent claims let exactly three through",
    allowed === 3,
    `${allowed} were allowed — a read-then-increment would let more than the cap through`,
  );

  const otherKey = `other_${stamp}`;
  keys.push(otherKey);
  const { data: other } = await supabase.rpc("claim_rate_limit", { p_key: otherKey, p_max: 3, p_window_seconds: 3600 });
  check("a different key has its own budget", other === true);

  console.log("\nThe signup endpoint\n");

  // Reach the plan lookup rather than the earlier legal-validation branch. The public endpoint
  // intentionally validates current legal versions before account creation, so this QA probe must
  // submit the same current document ids a real signup form would submit.
  const legalResponse = await fetch(`${BASE}/api/public/legal`);
  const legalBody = await legalResponse.json();
  const acceptedDocumentIds = (legalBody.documents ?? []).map((document) => document.id);

  // A plan code that does not exist: counted by the limiter, then refused at the plan lookup, so
  // nothing is ever created.
  const attempt = (n) =>
    fetch(`${BASE}/api/public/signup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${stamp % 200}` },
      body: JSON.stringify({
        fullName: "Rate Limit Probe",
        email: `probe_${stamp}_${n}@insurvas-verify.test`,
        password: "a-sufficiently-long-password",
        phone: "5551234567",
        planCode: "plan_that_does_not_exist",
        billingCycle: "monthly",
        acceptedDocumentIds,
      }),
    });

  // max + 2: enough to see the ceiling and to see that it stays closed once crossed.
  const max = ruleMax("SIGNUP_PER_IP");
  const statuses = [];
  for (let i = 0; i < max + 2; i++) statuses.push((await attempt(i)).status);

  check(
    `the first ${max} are let through to the plan check`,
    statuses.slice(0, max).every((s) => s === 409),
    `got ${statuses.join(", ")} — 409 means the limiter passed it on and the fake plan refused it`,
  );
  check(
    `requests ${max + 1} and ${max + 2} are refused with 429`,
    statuses[max] === 429 && statuses[max + 1] === 429,
    `got ${statuses.join(", ")} against SIGNUP_PER_IP.max = ${max}`,
  );

  const last = await attempt(99);
  check("the 429 carries a retry-after header", last.headers.get("retry-after") !== null,
        "without it a client cannot know when to try again");

  const { count } = await supabase
    .from("tenants").select("id", { count: "exact", head: true }).like("name", "%Rate Limit Probe%");
  check("no tenants were created by any of this", (count ?? 0) === 0, `${count} created`);
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll rate limit checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
