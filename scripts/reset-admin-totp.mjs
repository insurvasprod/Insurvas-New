// Shows or regenerates the TOTP secret for one admin.
//
//   npm run reset:totp -- someone@insurvas.com --show   read the CURRENT key, changes nothing
//   npm run reset:totp -- someone@insurvas.com          generate a NEW key, old codes stop working
//
// --show exists because reading your own key should not require destroying it: without it, the
// only way to see the manual entry code was to reset it and re-enrol every device.
import { createClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const showOnly = args.includes("--show");
const email = (args.find((a) => !a.startsWith("--")) ?? process.env.SEED_SUPER_ADMIN_EMAIL)?.toLowerCase();

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!email) {
  console.error("Usage: npm run reset:totp -- someone@insurvas.com");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

let totpSecret;

if (showOnly) {
  const { data: existing, error } = await supabase
    .from("admin_users")
    .select("email, totp_secret")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("Could not read the TOTP secret:", error.message);
    process.exit(1);
  }
  if (!existing) {
    console.error(`No admin_users row found for ${email}`);
    process.exit(1);
  }
  totpSecret = existing.totp_secret;
} else {
  totpSecret = new OTPAuth.Secret({ size: 20 }).base32;

  const { data: updated, error } = await supabase
    .from("admin_users")
    .update({ totp_secret: totpSecret })
    .eq("email", email)
    .select("email")
    .maybeSingle();

  if (error) {
    console.error("Could not reset TOTP secret:", error.message);
    process.exit(1);
  }
  if (!updated) {
    console.error(`No admin_users row found for ${email}`);
    process.exit(1);
  }
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

console.log(`\nTOTP secret reset for ${email}. Old codes no longer work.`);
console.log("Scan this, or use manual entry with the key printed below:\n");
console.log(await QRCode.toString(otpauthUri, { type: "terminal", small: true }));
console.log(`Manual entry key: ${totpSecret}`);
console.log(otpauthUri);
