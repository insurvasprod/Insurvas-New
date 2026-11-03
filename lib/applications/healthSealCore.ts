import { applicationKeyConfigured, decryptSensitive, encryptSensitive } from "./cryptoCore.ts";

/**
 * Health answers, notes, medications, their amendment history and the submission's health snapshot,
 * sealed field by field (2026-10-16). Same construction as SSNs (./cryptoCore.ts): AES-256-GCM, a
 * key per agency, and the ciphertext bound to its interview (or application) and to what it is, so
 * a sealed answer copied onto another question or another person does not open.
 *
 * Each table keeps one `sealed` column (JSON inside the ciphertext) and its `key_version`; the plain
 * columns are left null on a sealed row. Rows written before sealing are read as they are until
 * sealHealthBacklog (./healthSeal.ts) seals them, on the server that holds the production key.
 *
 * Without APPLICATION_DATA_ENCRYPTION_KEY nothing is sealed (the interview keeps working, in plain
 * text, as before); the backlog sealer picks those rows up once the key is set.
 */

type Sealed = { sealed: string | null; key_version: number | null };

function seal(tenantId: string, ownerId: string, what: string, payload: unknown): Sealed | null {
  if (!applicationKeyConfigured()) return null;
  const { ciphertext, keyVersion } = encryptSensitive(JSON.stringify(payload), { tenantId, applicationId: ownerId, fieldKey: what });
  return { sealed: ciphertext, key_version: keyVersion };
}

/** undefined: not sealed. null: sealed, but this server's key cannot open it. */
function open<T>(tenantId: string, ownerId: string, what: string, row: Sealed): T | null | undefined {
  if (!row.sealed) return undefined;
  if (!applicationKeyConfigured()) return null;
  const text = decryptSensitive(row.sealed, row.key_version, { tenantId, applicationId: ownerId, fieldKey: what });
  if (text === null) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

// ── answers ──────────────────────────────────────────────────────────────

export type AnswerRow = { interview_id: string; question_key: string; value: unknown; notes: string | null } & Partial<Sealed>;
export const ANSWER_COLUMNS = "interview_id, question_key, value, notes, sealed, key_version";

export function sealAnswer(tenantId: string, interviewId: string, key: string, value: unknown, notes: string | null) {
  const s = seal(tenantId, interviewId, `uw-answer:${key}`, { value: value ?? null, notes });
  return s ? { value: null, notes: null, ...s } : { value: value ?? null, notes, sealed: null, key_version: null };
}

export function openAnswer(tenantId: string, row: AnswerRow): { value: unknown; notes: string | null; unreadable?: true } {
  const got = open<{ value: unknown; notes: string | null }>(tenantId, row.interview_id, `uw-answer:${row.question_key}`, { sealed: row.sealed ?? null, key_version: row.key_version ?? null });
  if (got === undefined) return { value: row.value, notes: row.notes };
  if (got === null) return { value: null, notes: null, unreadable: true };
  return { value: got.value ?? null, notes: got.notes ?? null };
}

// ── medications ──────────────────────────────────────────────────────────

export type Medication = { name: string; dose: string | null; since: string | null; prescribed_for: string | null; prescribed_for_unknown: boolean; notes: string | null };
/** A stored row: on a sealed row the name and every detail are null. */
export type MedicationRow = Omit<Medication, "name"> & { name: string | null; id?: string; interview_id: string; sort_order?: number } & Partial<Sealed>;
export const MEDICATION_COLUMNS = "id, interview_id, name, dose, since, prescribed_for, prescribed_for_unknown, notes, sort_order, sealed, key_version";

export function sealMedication(tenantId: string, interviewId: string, med: Medication) {
  const s = seal(tenantId, interviewId, "uw-medication", med);
  // prescribed_for_unknown stays readable: it is a yes/no with no health detail, and a check reads it.
  return s ? { name: null, dose: null, since: null, prescribed_for: null, prescribed_for_unknown: med.prescribed_for_unknown, notes: null, ...s } : { ...med, sealed: null, key_version: null };
}

export function openMedication(tenantId: string, row: MedicationRow): Medication & { unreadable?: true } {
  const got = open<Medication>(tenantId, row.interview_id, "uw-medication", { sealed: row.sealed ?? null, key_version: row.key_version ?? null });
  if (got === undefined) return { name: row.name ?? "", dose: row.dose, since: row.since, prescribed_for: row.prescribed_for, prescribed_for_unknown: row.prescribed_for_unknown, notes: row.notes };
  if (got === null) return { name: "(cannot be read on this server)", dose: null, since: null, prescribed_for: null, prescribed_for_unknown: false, notes: null, unreadable: true };
  return got;
}

// ── amendment history (append-only) ──────────────────────────────────────

export function sealChange(tenantId: string, interviewId: string, key: string, from: unknown, to: unknown) {
  const s = seal(tenantId, interviewId, `uw-change:${key}`, { old: from ?? null, new: to ?? null });
  return s ? { old_value: null, new_value: null, ...s } : { old_value: from ?? null, new_value: to ?? null, sealed: null, key_version: null };
}

export function openChange(tenantId: string, row: { interview_id: string; question_key: string; old_value: unknown; new_value: unknown } & Partial<Sealed>) {
  const got = open<{ old: unknown; new: unknown }>(tenantId, row.interview_id, `uw-change:${row.question_key}`, { sealed: row.sealed ?? null, key_version: row.key_version ?? null });
  if (got === undefined) return { old: row.old_value, new: row.new_value };
  return got ?? { old: null, new: null, unreadable: true as const };
}

// ── the submission's health snapshot ─────────────────────────────────────

export function sealSnapshot(tenantId: string, applicationId: string, snapshot: Record<string, unknown>): Record<string, unknown> {
  if (!Object.keys(snapshot).length) return {};
  const s = seal(tenantId, applicationId, "health-snapshot", snapshot);
  return s ? { sealed: s.sealed, key_version: s.key_version } : snapshot;
}

export function openSnapshot(tenantId: string, applicationId: string, stored: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof stored.sealed !== "string") return stored;
  return open<Record<string, unknown>>(tenantId, applicationId, "health-snapshot", { sealed: stored.sealed, key_version: typeof stored.key_version === "number" ? stored.key_version : null }) ?? null;
}
