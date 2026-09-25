// SA-2.7: verifies completed subscription mutation responses are replayed without a second write.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failures = 0;
const check = (label, condition, detail = "") => { console.log(condition ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` — ${detail}` : ""}`); if (!condition) failures++; };

const stamp = Date.now();
const { data: admin } = await db.from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).single();
const { data: plan } = await db.from("plans").select("id").eq("code", "basic").order("version", { ascending: false }).limit(1).single();
const { data: tenant } = await db.from("tenants").insert({ name: `SA27 idempotency ${stamp}`, status: "active" }).select("id").single();
const cookie = `insurvas_admin_session=${await new SignJWT({ role: "super_admin", stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;

const request = (key, body) => fetch(`${BASE}/api/admin/subscriptions`, {
  method: "POST",
  headers: { "content-type": "application/json", "Idempotency-Key": key, cookie },
  body: JSON.stringify(body),
});

try {
  const body = { tenant_id: tenant.id, plan_id: plan.id, billing_cycle: "monthly" };
  const key = `sa27_${stamp}_${randomUUID()}`;
  const first = await request(key, body);
  const firstBody = await first.json();
  const replay = await request(key, body);
  const replayBody = await replay.json();
  const { data: subscriptions } = await db.from("subscriptions").select("id").eq("tenant_id", tenant.id);
  const { data: requests } = await db.from("subscription_mutation_requests").select("status, response_status, operation").eq("actor_id", admin.id).eq("idempotency_key", key);
  check("first assignment succeeds", first.status === 201 && firstBody.subscriptionId);
  check("same key replays the original response", replay.status === 201 && replayBody.subscriptionId === firstBody.subscriptionId, `HTTP ${replay.status}`);
  check("replay is explicitly marked", replay.headers.get("Idempotency-Replayed") === "true");
  check("replay does not create a second subscription", subscriptions?.length === 1, `count ${subscriptions?.length}`);
  check("request ledger stores one succeeded row", requests?.length === 1 && requests[0].status === "succeeded" && requests[0].response_status === 201);

  const conflict = await request(key, { ...body, billing_cycle: "yearly" });
  const conflictBody = await conflict.json();
  check("reusing a key for a different request is rejected", conflict.status === 409 && /different request/i.test(conflictBody.error ?? ""));
} finally {
  await db.from("subscription_mutation_requests").delete().eq("actor_id", admin.id).like("idempotency_key", `sa27_${stamp}_%`);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenant.id);
  await db.from("subscriptions").delete().eq("tenant_id", tenant.id);
  await db.from("tenants").delete().eq("id", tenant.id);
}

console.log(failures === 0 ? "\nAll subscription idempotency checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
