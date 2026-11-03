/**
 * QA helper: prints the email-verification link a signup would have emailed.
 *
 * Localhost runs with EMAIL_DELIVERY_MODE unset, so no verification email is ever sent and the
 * signup journey cannot be walked past "Check your email". This re-issues the link through the
 * product's own path — admin_replace_user_token(purpose 'email_verification'), which revokes any
 * earlier link — and prints the URL the email would carry. The token itself is never stored; only
 * its SHA-256 hash is, exactly as the signup route does.
 *
 * Only for addresses on test domains, so it can never be pointed at a real customer.
 *
 *   node --env-file=.env.local scripts/qa-verification-link.mjs someone@qa-demo.insurvas.test
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/@(qa-demo\.insurvas\.test|insurvas\.test|invalid\.test)$/.test(email)) {
  console.error("usage: qa-verification-link.mjs <address on a test domain: @qa-demo.insurvas.test, @insurvas.test, @invalid.test>");
  process.exit(1);
}
const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
if (!origin) { console.error("NEXT_PUBLIC_APP_URL is not set"); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: user, error } = await db.from("users").select("id, status").eq("email", email).maybeSingle();
if (error || !user) { console.error("No user with that email", error?.message ?? ""); process.exit(1); }
if (user.status !== "pending_verification") { console.error(`User is ${user.status}, not pending_verification — nothing to verify.`); process.exit(1); }

const token = randomBytes(32).toString("base64url");
const { error: tokenError } = await db.rpc("admin_replace_user_token", {
  p_user_id: user.id,
  p_purpose: "email_verification",
  p_token_hash: createHash("sha256").update(token).digest("hex"),
  p_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  p_created_by: null,
});
if (tokenError) { console.error("Could not issue a link:", tokenError.message); process.exit(1); }
console.log(`${origin}/api/public/signup/verify?token=${encodeURIComponent(token)}`);
