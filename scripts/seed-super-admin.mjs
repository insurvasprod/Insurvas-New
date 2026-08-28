// Seeds exactly one super_admin on a fresh install (SA-0.1 acceptance criteria).
// Run with: npm run seed:super-admin
// Requires SUPABASE_SERVICE_ROLE_KEY + SEED_SUPER_ADMIN_EMAIL/NAME/PASSWORD in .env.local.
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_SUPER_ADMIN_EMAIL;
const name = process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin";
const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email || !password) {
  console.error("Missing SEED_SUPER_ADMIN_EMAIL or SEED_SUPER_ADMIN_PASSWORD in .env.local");
  process.exit(1);
}
if (password.length < 12) {
  console.error("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { count, error: countError } = await supabase
  .from("admin_users")
  .select("id", { count: "exact", head: true });

if (countError) {
  console.error("Could not read admin_users:", countError.message);
  process.exit(1);
}

if (count && count > 0) {
  console.log(`admin_users already has ${count} row(s) — skipping seed.`);
  process.exit(0);
}

const passwordHash = await bcrypt.hash(password, 12);
const totpSecret = new OTPAuth.Secret({ size: 20 }).base32;

const { error: insertError } = await supabase.from("admin_users").insert({
  email: email.toLowerCase(),
  name,
  role: "super_admin",
  password_hash: passwordHash,
  totp_secret: totpSecret,
  is_active: true,
});

if (insertError) {
  console.error("Could not create super_admin:", insertError.message);
  process.exit(1);
}

const totp = new OTPAuth.TOTP({
  issuer: "Insurvas Admin",
  label: email,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(totpSecret),
});
const otpauthUri = totp.toString();

console.log(`\nCreated super_admin: ${email}`);
console.log("Scan this before your first login (2FA is mandatory), or use manual entry:\n");
console.log(await QRCode.toString(otpauthUri, { type: "terminal", small: true }));
console.log(`Manual entry key: ${totpSecret}`);
console.log(otpauthUri);
