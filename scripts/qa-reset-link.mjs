/**
 * QA helper: prints the password-reset link "Forgot password" would have emailed.
 *
 * Localhost runs with EMAIL_DELIVERY_MODE unset, so the reset email is never sent and the journey
 * stops at "Check your email". This issues the link through the product's own path, the one
 * app/api/app/auth/forgot-password/route.ts takes: admin_replace_user_token(purpose 'password_reset'),
 * which revokes any earlier link, and prints the /app/set-password URL the email would carry. Only the
 * token's SHA-256 hash is stored, as the route does. The same checks gate it: an active user with an
 * accepted membership; anyone else is refused here as the route silently refuses them.
 *
 * Only for addresses on test domains, so it can never be pointed at a real customer.
 * --expired issues a link that has already expired, to check the "no longer works" page.
 *
 *   node --env-file=.env.local scripts/qa-reset-link.mjs someone@insurvas.test [--expired]
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const expired = process.argv.includes("--expired");
if (!/@(qa-demo\.insurvas\.test|insurvas\.test|invalid\.test)$/.test(email)) {
  console.error("usage: qa-reset-link.mjs <address on a test domain: @qa-demo.insurvas.test, @insurvas.test, @invalid.test> [--expired]");
  process.exit(1);
}
const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
if (!origin) { console.error("NEXT_PUBLIC_APP_URL is not set"); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: user, error } = await db.from("users").select("id, status").eq("email", email).maybeSingle();
if (error || !user) { console.error("No user with that email", error?.message ?? ""); process.exit(1); }
if (user.status !== "active") { console.error(`User is ${user.status}, not active — Forgot password sends nothing to them.`); process.exit(1); }
const { count } = await db.from("tenant_users").select("user_id", { count: "exact", head: true }).eq("user_id", user.id).not("accepted_at", "is", null);
if (!count) { console.error("No accepted membership — this person finishes their invite instead; Forgot password sends nothing."); process.exit(1); }

const token = randomBytes(32).toString("base64url");
const { error: tokenError } = await db.rpc("admin_replace_user_token", {
  p_user_id: user.id,
  p_purpose: "password_reset",
  p_token_hash: createHash("sha256").update(token).digest("hex"),
  p_expires_at: new Date(Date.now() + (expired ? -3600 : 24 * 3600) * 1000).toISOString(),
  p_created_by: null,
});
if (tokenError) { console.error("Could not issue a link:", tokenError.message); process.exit(1); }
console.log(`${origin}/app/set-password?token=${encodeURIComponent(token)}`);
