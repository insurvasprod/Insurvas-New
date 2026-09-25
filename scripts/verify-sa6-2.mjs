// SA-6.2 endpoint-level verifier. Uses a nonexistent email and a reserved documentation IP;
// it never authenticates, sends mail, creates a tenant, or changes a real account.
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now();
const email = `sa62_probe_${stamp}@invalid.test`;
const ip = `198.51.100.${(stamp % 200) + 1}`;
const loginKey = `login_admin_email:${email}`;
const ipKey = `login_admin_ip:${ip}`;
const lockoutPrefix = `login_lockout:login:admin:${encodeURIComponent(email)}:`;
let failures = 0;
const check = (label, condition, detail = "") => {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; }
};

const attempt = () => fetch(`${BASE}/api/admin/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": ip },
  body: JSON.stringify({ email, password: "not-the-password" }),
});

try {
  const responses = [];
  for (let i = 0; i < 7; i += 1) responses.push(await attempt());
  const statuses = responses.map((response) => response.status);
  check("five attempts reach generic credential handling", statuses.slice(0, 5).every((status) => status === 401), statuses.join(", "));
  check("the sixth and seventh attempts receive 429", statuses[5] === 429 && statuses[6] === 429, statuses.join(", "));
  check("the 429 includes Retry-After", responses[5].headers.get("retry-after") !== null);
  const body = await responses[5].json();
  check("rate limiting keeps the generic login message", body.error === "Invalid email or password");

  const { data: counters, error } = await db
    .from("rate_limits")
    .select("bucket_key, hits")
    .or(`bucket_key.eq.${loginKey},bucket_key.eq.${ipKey},bucket_key.like.${lockoutPrefix}%`);
  check("persistent email/IP and failed-login counters were written", !error && (counters?.length ?? 0) >= 3, error?.message);
} catch (error) {
  check("the local app is reachable", false, error instanceof Error ? error.message : String(error));
} finally {
  await db.from("rate_limits").delete().in("bucket_key", [loginKey, ipKey]);
  await db.from("rate_limits").delete().like("bucket_key", `${lockoutPrefix}%`);
  await db.from("login_events").delete().eq("email", email);
}

console.log(failures === 0 ? "\nSA-6.2 endpoint checks passed." : `\n${failures} SA-6.2 check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
