// Verifies the public-endpoint rate limits added after the SA-5.1 review.
//
// The HTTP half deliberately uses a plan code that does not exist: the limiter runs BEFORE the
// plan lookup, so requests are counted and then rejected downstream — proving the wiring without
// creating a single tenant, user or email.
//
// Needs the app running. Run with: npm run verify:ratelimit
import { createClient } from "@supabase/supabase-js";

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
      }),
    });

  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await attempt(i)).status);

  check(
    "the first five are let through to the plan check",
    statuses.slice(0, 5).every((s) => s === 409),
    `got ${statuses.join(", ")} — 409 means the limiter passed it on and the fake plan refused it`,
  );
  check(
    "the sixth and seventh are refused with 429",
    statuses[5] === 429 && statuses[6] === 429,
    `got ${statuses.join(", ")}`,
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
