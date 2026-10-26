import "server-only";

import { createHash, randomInt } from "node:crypto";
import * as OTPAuth from "otpauth";
import { NextResponse } from "next/server";

import { decryptSensitive, encryptSensitive } from "@/lib/applications/crypto";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantContext } from "./requireTenant";
import {
  formatRecoveryCode, normaliseRecoveryCode, RECOVERY_ALPHABET, RECOVERY_CODE_COUNT,
  TWO_FACTOR_REQUIRED_CODE, TWO_FACTOR_REQUIRED_MESSAGE, TWO_FACTOR_SESSION_MESSAGE,
} from "./securityRules";

/**
 * LA-8.2 (Notion sprint) · two-factor authentication for agency users: an authenticator app (TOTP),
 * never SMS — SIM swapping is a real attack and the weaker factor is not shipped as the default.
 *
 * The secret is encrypted with the application data key (lib/applications/crypto.ts), bound to the
 * person: the "tenant" HKDF salt is the user id, because 2FA belongs to the account, not a workspace.
 * Recovery codes are stored as SHA-256 hashes and shown once.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tables are not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;
const ISSUER = "Insurvas";
const scope = (userId: string) => ({ tenantId: userId, applicationId: userId, fieldKey: "user.totp_secret" });

function totp(label: string, secret: string) {
  return new OTPAuth.TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}

export class TwoFactorError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Row = { secret_ciphertext: string; key_version: number; enabled_at: string | null };

async function row(userId: string): Promise<Row | null> {
  const { data, error } = await db().from("user_two_factor").select("secret_ciphertext, key_version, enabled_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isPendingSchema(error)) return null;
    throw new Error(`Could not read two-factor settings: ${error.message}`);
  }
  return (data as Row | null) ?? null;
}

/** On, waiting for its first code, or off — and how many recovery codes are left. */
export async function twoFactorStatus(userId: string): Promise<{ enabled: boolean; enabledAt: string | null; pending: boolean; recoveryCodesLeft: number }> {
  const r = await row(userId);
  if (!r) return { enabled: false, enabledAt: null, pending: false, recoveryCodesLeft: 0 };
  let left = 0;
  if (r.enabled_at) {
    const { count } = await db().from("user_recovery_code").select("id", { count: "exact", head: true }).eq("user_id", userId).is("used_at", null);
    left = count ?? 0;
  }
  return { enabled: Boolean(r.enabled_at), enabledAt: r.enabled_at, pending: !r.enabled_at, recoveryCodesLeft: left };
}

export async function hasTwoFactor(userId: string): Promise<boolean> {
  return Boolean((await row(userId))?.enabled_at);
}

/** When the authenticator now in use was set up; null when two-factor is off. A trusted device is bound to it. */
export async function twoFactorEnabledAt(userId: string): Promise<string | null> {
  return (await row(userId))?.enabled_at ?? null;
}

/** Begin enrolment: a fresh secret, stored unconfirmed. Returns what the authenticator app needs. */
export async function startEnrolment(userId: string, email: string): Promise<{ uri: string; secret: string }> {
  const existing = await row(userId);
  if (existing?.enabled_at) throw new TwoFactorError("Two-factor authentication is already on.", 409);
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const { ciphertext, keyVersion } = encryptSensitive(secret, scope(userId));
  const { error } = await db().from("user_two_factor").upsert({ user_id: userId, secret_ciphertext: ciphertext, key_version: keyVersion, enabled_at: null, last_totp_step: null, created_at: new Date().toISOString() });
  if (error) {
    if (isPendingSchema(error)) throw new TwoFactorError("Two-factor authentication needs a database update before it can be turned on.", 503);
    throw new Error(error.message);
  }
  return { uri: totp(email, secret).toString(), secret };
}

/** The time step a code belongs to (±1 step of clock drift), or null. */
function stepFor(r: Row, userId: string, code: string): number | null {
  const secret = decryptSensitive(r.secret_ciphertext, r.key_version, scope(userId));
  if (!secret) throw new TwoFactorError("Two-factor could not be read on this server.", 503);
  const t = totp("", secret);
  const delta = t.validate({ token: code.replace(/\s/g, ""), window: 1 });
  return delta === null ? null : t.counter() + delta;
}

const hash = (code: string) => createHash("sha256").update(`insurvas:recovery:${normaliseRecoveryCode(code)}`, "utf8").digest("hex");

function newRecoveryCodes(): { shown: string[]; hashes: string[] } {
  const shown = Array.from({ length: RECOVERY_CODE_COUNT }, () => formatRecoveryCode(Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("")));
  return { shown, hashes: shown.map(hash) };
}

/** Finish enrolment with the first code: 2FA is on, and the recovery codes are returned — once. */
export async function confirmEnrolment(userId: string, code: string): Promise<string[]> {
  const r = await row(userId);
  if (!r || r.enabled_at) throw new TwoFactorError(r ? "Two-factor authentication is already on." : "Start setting up two-factor first.", 409);
  const step = stepFor(r, userId, code);
  if (step === null) throw new TwoFactorError("That code is not right. Check the time on your phone and try the newest code.", 400);
  const codes = newRecoveryCodes();
  const { error } = await db().rpc("enable_user_two_factor", { p_user_id: userId, p_step: step, p_code_hashes: codes.hashes });
  if (error) throw new TwoFactorError(error.message.replace(/^\w+: /, ""), 400);
  return codes.shown;
}

/**
 * Check a code for a person with 2FA on: an authenticator code (each accepted once), or a recovery
 * code (each usable once). Returns which kind matched, or null.
 */
export async function verifySecondFactor(userId: string, input: { code?: string; recoveryCode?: string }): Promise<"totp" | "recovery" | null> {
  const r = await row(userId);
  if (!r?.enabled_at) return null;
  if (input.code) {
    const step = stepFor(r, userId, input.code);
    if (step === null) return null;
    const { data, error } = await db().rpc("claim_user_totp_step", { p_user_id: userId, p_step: step });
    if (error) throw new Error(error.message);
    return data === true ? "totp" : null;
  }
  if (input.recoveryCode && normaliseRecoveryCode(input.recoveryCode).length === 10) {
    const { data, error } = await db().rpc("use_user_recovery_code", { p_user_id: userId, p_code_hash: hash(input.recoveryCode) });
    if (error) throw new Error(error.message);
    return data === true ? "recovery" : null;
  }
  return null;
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  const { error } = await db().rpc("replace_user_recovery_codes", { p_user_id: userId, p_code_hashes: codes.hashes });
  if (error) throw new TwoFactorError(error.message.replace(/^\w+: /, ""), 400);
  return codes.shown;
}

export async function disableTwoFactor(userId: string): Promise<void> {
  const { error } = await db().rpc("disable_user_two_factor", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

/**
 * The gate on every sensitive reveal (SSN, bank details, tax IDs): the person has 2FA on, and — for a
 * browser session — this session passed it. Blocks the reveal only; the rest of the product carries on.
 * `null` means go ahead. An extension or other non-session caller passes no session and is checked
 * for enrolment alone.
 */
export async function secondFactorBlock(context: Pick<TenantContext, "userId" | "sessionId" | "twoFactorAt">, opts: { session?: boolean } = { session: true }): Promise<NextResponse | null> {
  const on = await hasTwoFactor(context.userId).catch(() => false);
  if (!on) return NextResponse.json({ error: TWO_FACTOR_REQUIRED_MESSAGE, code: TWO_FACTOR_REQUIRED_CODE }, { status: 403 });
  if (opts.session !== false && !context.twoFactorAt) return NextResponse.json({ error: TWO_FACTOR_SESSION_MESSAGE, code: TWO_FACTOR_REQUIRED_CODE }, { status: 403 });
  return null;
}
