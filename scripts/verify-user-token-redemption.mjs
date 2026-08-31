import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase service environment");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const tenantId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();
const originalEmail = `token-user-${stamp}@example.test`;
const occupiedEmail = `token-occupied-${stamp}@example.test`;
const replacementEmail = `token-new-${stamp}@example.test`;

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function check(label, condition) {
  assert.ok(condition, label);
  console.log(`  ok   ${label}`);
}

async function cleanup() {
  await supabase.from("user_invitations").delete().in("user_id", [userId, otherUserId]);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  await supabase.from("users").delete().in("id", [userId, otherUserId]);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

try {
  const { error: tenantError } = await supabase
    .from("tenants")
    .insert({ id: tenantId, name: `Token verification ${stamp}`, status: "active", onboarding_state: "complete" });
  if (tenantError) throw tenantError;

  const { error: usersError } = await supabase.from("users").insert([
    { id: userId, email: originalEmail, name: "Token User", status: "active" },
    { id: otherUserId, email: occupiedEmail, name: "Existing Email Owner", status: "active" },
  ]);
  if (usersError) throw usersError;

  const { error: membershipError } = await supabase
    .from("tenant_users")
    .insert({ tenant_id: tenantId, user_id: userId, role: "owner", accepted_at: null });
  if (membershipError) throw membershipError;

  const passwordToken = randomBytes(32).toString("base64url");
  const passwordTokenHash = hashToken(passwordToken);
  const { error: passwordTokenError } = await supabase.from("user_invitations").insert({
    user_id: userId,
    token_hash: passwordTokenHash,
    purpose: "invite",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (passwordTokenError) throw passwordTokenError;

  const candidateHashes = ["concurrent-password-one", "concurrent-password-two"];
  const passwordResults = await Promise.all(
    candidateHashes.map((candidate) =>
      supabase.rpc("consume_user_password_token", {
        p_token_hash: passwordTokenHash,
        p_password_hash: candidate,
      }),
    ),
  );
  const successfulPasswordIndexes = passwordResults
    .map((result, index) => (result.error ? -1 : index))
    .filter((index) => index >= 0);
  check("exactly one concurrent password redemption succeeds", successfulPasswordIndexes.length === 1);
  check(
    "the losing password redemption is rejected as an invalid/consumed token",
    passwordResults.some((result) => result.error?.message.includes("PASSWORD_TOKEN_INVALID_OR_EXPIRED")),
  );

  const [{ data: passwordUser }, { data: invite }, { data: membership }] = await Promise.all([
    supabase.from("users").select("password_hash").eq("id", userId).single(),
    supabase.from("user_invitations").select("accepted_at").eq("token_hash", passwordTokenHash).single(),
    supabase.from("tenant_users").select("accepted_at").eq("user_id", userId).single(),
  ]);
  check(
    "the stored password belongs to the sole winning request",
    passwordUser.password_hash === candidateHashes[successfulPasswordIndexes[0]],
  );
  check("the invitation is consumed", Boolean(invite.accepted_at));
  check("an accepted invitation accepts the membership", Boolean(membership.accepted_at));

  const emailToken = randomBytes(32).toString("base64url");
  const emailTokenHash = hashToken(emailToken);
  const { error: emailTokenError } = await supabase.from("user_invitations").insert({
    user_id: userId,
    token_hash: emailTokenHash,
    purpose: "email_change",
    new_email: occupiedEmail,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (emailTokenError) throw emailTokenError;

  const duplicate = await supabase.rpc("consume_user_email_change_token", { p_token_hash: emailTokenHash });
  check("a duplicate replacement email is rejected", duplicate.error?.message.includes("EMAIL_ALREADY_REGISTERED"));

  const [{ data: unchangedUser }, { data: unconsumedEmailToken }] = await Promise.all([
    supabase.from("users").select("email").eq("id", userId).single(),
    supabase.from("user_invitations").select("accepted_at").eq("token_hash", emailTokenHash).single(),
  ]);
  check("a rejected email change leaves the account unchanged", unchangedUser.email === originalEmail);
  check("a rejected email change leaves its token usable", unconsumedEmailToken.accepted_at === null);

  const { error: retargetError } = await supabase
    .from("user_invitations")
    .update({ new_email: replacementEmail })
    .eq("token_hash", emailTokenHash);
  if (retargetError) throw retargetError;

  const emailResults = await Promise.all([
    supabase.rpc("consume_user_email_change_token", { p_token_hash: emailTokenHash }),
    supabase.rpc("consume_user_email_change_token", { p_token_hash: emailTokenHash }),
  ]);
  check("exactly one concurrent email confirmation succeeds", emailResults.filter((result) => !result.error).length === 1);
  check(
    "the losing email confirmation is rejected as an invalid/consumed token",
    emailResults.some((result) => result.error?.message.includes("EMAIL_CHANGE_TOKEN_INVALID_OR_EXPIRED")),
  );

  const { data: changedUser } = await supabase.from("users").select("email").eq("id", userId).single();
  check("the winning email confirmation commits the replacement address", changedUser.email === replacementEmail);

  console.log("\n11/11 atomic user-token checks passed");
} finally {
  await cleanup();
}
