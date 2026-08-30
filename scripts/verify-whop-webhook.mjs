// SA-3.1 acceptance: drives the real /api/webhooks/whop endpoint with genuinely signed requests.
//
// Needs the app running. Defaults to the dev server; set WEBHOOK_TARGET_URL to point at a deploy.
// Never prints the secret. Cleans up every row it creates.
//
// Run with: npm run verify:webhook
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const secret = process.env.WHOP_WEBHOOK_SECRET;
const TARGET = process.env.WEBHOOK_TARGET_URL ?? "http://localhost:3000/api/webhooks/whop";
if (!secret) { console.error("WHOP_WEBHOOK_SECRET missing from .env.local"); process.exit(1); }
console.log(`secret loaded: ${secret.slice(0, 3)}… (${secret.length} chars)`);
console.log(`target: ${TARGET}`);

const stamp = Date.now();
const eventId = `msg_localtest_${stamp}`;
const body = JSON.stringify({
  id: eventId, type: "payment.succeeded", api_version: "v1",
  timestamp: new Date().toISOString(), account_id: "biz_TEST",
  data: { id: `pay_${stamp}`, user: "user_nobody_here", total: 44999 },
});

/**
 * `signPayload` defaults to the body being sent. Passing a DIFFERENT value is how the tampering
 * test works: sign one thing, send another. An earlier version of this script signed whatever it
 * sent, so the tamper check was signing the tampered body and passing vacuously.
 */
function post(bodyText, { id = eventId, ts = Math.floor(Date.now() / 1000), sigSecret = secret, signPayload } = {}) {
  const signed = signPayload ?? bodyText;
  const sig = createHmac("sha256", sigSecret).update(`${id}.${ts}.${signed}`).digest("base64");
  return fetch(TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    },
    body: bodyText,
  });
}

let failures = 0;
async function check(label, res, expectStatus, expectBody) {
  const json = await res.json().catch(() => ({}));
  const okStatus = res.status === expectStatus;
  const okBody = expectBody ? expectBody(json) : true;
  if (okStatus && okBody) console.log(`  ok   ${label}  [${res.status}] ${JSON.stringify(json)}`);
  else { console.log(`  FAIL ${label}  expected ${expectStatus}, got ${res.status} ${JSON.stringify(json)}`); failures++; }
}

console.log("\nLive endpoint\n");

await check("a genuinely signed event is accepted", await post(body), 200, (j) => j.ok === true && !j.duplicate);
await check("the same webhook-id again is a duplicate", await post(body), 200, (j) => j.duplicate === true);

// Sign the original, send an altered amount, under a fresh id so duplicate handling can't mask it.
await check(
  "a body altered after signing is refused",
  await post(body.replace("44999", "1"), { id: `${eventId}_tamper`, signPayload: body }),
  401,
);

await check("a wrong secret is refused", await post(body, { id: `${eventId}_wrongkey`, sigSecret: "ws_wrong" }), 401);
await check("a replayed old timestamp is refused", await post(body, { id: `${eventId}_old`, ts: Math.floor(Date.now() / 1000) - 400 }), 401);
await check("an unsubscribed event type is stored but ignored", await post(
  JSON.stringify({ id: `${eventId}_x`, type: "card.frozen", data: {} }), { id: `${eventId}_x` }), 200,
  (j) => j.ignored === "card.frozen");
await check("GET is not allowed", await fetch(TARGET), 405);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: rows } = await supabase
  .from("webhook_events").select("event_id, event_type, processed_at, tenant_id")
  .like("event_id", `msg_localtest_${stamp}%`);

console.log(`\nStored rows: ${rows?.length ?? 0}`);
for (const r of rows ?? []) console.log(`  ${r.event_type.padEnd(20)} processed=${r.processed_at !== null} tenant=${r.tenant_id ?? "unmapped"}`);

// Only the two accepted events may be stored. A rejected request must never reach the table —
// if it did, an unsigned caller could fill the log.
if ((rows ?? []).length !== 2) { console.log(`  FAIL expected exactly 2 stored rows, got ${(rows ?? []).length}`); failures++; }
else console.log("  ok   rejected requests stored nothing, and the duplicate created no second row");

await supabase.from("webhook_events").delete().like("event_id", `msg_localtest_${stamp}%`);
console.log("\nCleaned up.");
console.log(failures === 0 ? "All live endpoint checks passed." : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
