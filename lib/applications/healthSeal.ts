import "server-only";

import { db, rows } from "./db";
import { applicationKeyConfigured } from "./crypto";
import {
  ANSWER_COLUMNS, MEDICATION_COLUMNS, openAnswer, openChange, openMedication, openSnapshot, sealAnswer, sealChange, sealMedication, sealSnapshot,
  type AnswerRow, type Medication, type MedicationRow,
} from "./healthSealCore";

export { sealAnswer, sealChange, sealMedication, sealSnapshot, openSnapshot };

/**
 * Reading and writing health answers through the seal (./healthSealCore.ts). Until migration
 * 20261016420000 is live the sealed columns do not exist: everything then reads and writes the plain
 * columns as before, so the interview keeps working either side of the migration.
 */
let ready: Promise<boolean> | null = null;
export function sealingReady(): Promise<boolean> {
  ready ??= Promise.resolve(db().from("tenant_uw_answers").select("sealed").limit(1))
    .then(({ error }: { error: { code?: string } | null }) => !error)
    .catch(() => false);
  return ready.then((ok) => { if (!ok) ready = null; return ok; });
}

const LEGACY_ANSWER_COLUMNS = "interview_id, question_key, value, notes";
const LEGACY_MEDICATION_COLUMNS = "id, interview_id, name, dose, since, prescribed_for, prescribed_for_unknown, notes, sort_order";

/** Answers of one or more interviews, opened. */
export async function loadAnswers(tenantId: string, interviewIds: string[]) {
  if (!interviewIds.length) return { rows: [] as Array<{ interview_id: string; question_key: string; value: unknown; notes: string | null }>, error: null };
  const sealed = await sealingReady();
  const res = await db().from("tenant_uw_answers").select(sealed ? ANSWER_COLUMNS : LEGACY_ANSWER_COLUMNS).eq("tenant_id", tenantId).in("interview_id", interviewIds);
  if (res.error) return { rows: [], error: res.error };
  return { rows: rows<AnswerRow>(res.data).map((r) => ({ interview_id: r.interview_id, question_key: r.question_key, ...openAnswer(tenantId, r) })), error: null };
}

/** Medications of one or more interviews, opened, in their order. */
export async function loadMedications(tenantId: string, interviewIds: string[]) {
  if (!interviewIds.length) return { rows: [] as Array<Medication & { id?: string; interview_id: string }>, error: null };
  const sealed = await sealingReady();
  const res = await db().from("tenant_medications").select(sealed ? MEDICATION_COLUMNS : LEGACY_MEDICATION_COLUMNS).eq("tenant_id", tenantId).in("interview_id", interviewIds).order("sort_order");
  if (res.error) return { rows: [], error: res.error };
  return { rows: rows<MedicationRow>(res.data).map((r) => ({ id: r.id, interview_id: r.interview_id, ...openMedication(tenantId, r) })), error: null };
}

/** The columns to write for an answer: sealed when the schema and the key allow it. */
export async function answerColumns(tenantId: string, interviewId: string, key: string, value: unknown, notes: string | null) {
  if (!(await sealingReady())) return { value: value ?? null, notes };
  return sealAnswer(tenantId, interviewId, key, value, notes);
}

export async function medicationColumns(tenantId: string, interviewId: string, med: Medication) {
  if (!(await sealingReady())) return med;
  return sealMedication(tenantId, interviewId, med);
}

export async function changeColumns(tenantId: string, interviewId: string, key: string, from: unknown, to: unknown) {
  if (!(await sealingReady())) return { old_value: from ?? null, new_value: to ?? null };
  return sealChange(tenantId, interviewId, key, from, to);
}

export async function snapshotFor(tenantId: string, applicationId: string, snapshot: Record<string, unknown>) {
  if (!(await sealingReady())) return snapshot;
  return sealSnapshot(tenantId, applicationId, snapshot);
}

/**
 * Seals what was written before sealing (super-admin action, run on the server holding the production
 * key). Each row is sealed, opened again with this server's key and compared before its plain copy is
 * cleared, so a wrong key never leaves a row nobody can read. Batches of 200 per table; call again
 * until `remaining` is 0.
 */
export async function sealHealthBacklog() {
  if (!applicationKeyConfigured()) throw new Error("APPLICATION_DATA_ENCRYPTION_KEY is not set on this server, so nothing can be sealed.");
  if (!(await sealingReady())) throw new Error("Migration 20261016420000 is not applied yet.");
  const client = db();
  const out = { answers: 0, medications: 0, changes: 0, snapshots: 0, failed: 0, remaining: 0 };
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const answers = await client.from("tenant_uw_answers").select(ANSWER_COLUMNS + ", tenant_id").is("sealed", null).or("value.not.is.null,notes.not.is.null").limit(200);
  if (answers.error) throw new Error(answers.error.message);
  for (const r of rows<AnswerRow & { tenant_id: string }>(answers.data)) {
    const cols = sealAnswer(r.tenant_id, r.interview_id, r.question_key, r.value, r.notes);
    const back = openAnswer(r.tenant_id, { ...r, ...cols });
    if (!cols.sealed || back.unreadable || !same(back.value, r.value) || !same(back.notes, r.notes)) { out.failed++; continue; }
    const up = await client.from("tenant_uw_answers").update(cols).eq("tenant_id", r.tenant_id).eq("interview_id", r.interview_id).eq("question_key", r.question_key).is("sealed", null);
    if (up.error) out.failed++; else out.answers++;
  }

  const meds = await client.from("tenant_medications").select(MEDICATION_COLUMNS + ", tenant_id").is("sealed", null).limit(200);
  if (meds.error) throw new Error(meds.error.message);
  for (const r of rows<MedicationRow & { tenant_id: string; id: string }>(meds.data)) {
    const med: Medication = { name: r.name ?? "", dose: r.dose, since: r.since, prescribed_for: r.prescribed_for, prescribed_for_unknown: r.prescribed_for_unknown, notes: r.notes };
    const cols = sealMedication(r.tenant_id, r.interview_id, med);
    if (!cols.sealed || !same(openMedication(r.tenant_id, { ...r, ...cols }), med)) { out.failed++; continue; }
    const up = await client.from("tenant_medications").update(cols).eq("tenant_id", r.tenant_id).eq("id", r.id).is("sealed", null);
    if (up.error) out.failed++; else out.medications++;
  }

  const changes = await client.from("tenant_uw_answer_changes").select("id, tenant_id, interview_id, question_key, old_value, new_value, sealed, key_version").is("sealed", null).limit(200);
  if (changes.error) throw new Error(changes.error.message);
  for (const r of rows<{ id: string; tenant_id: string; interview_id: string; question_key: string; old_value: unknown; new_value: unknown; sealed: string | null; key_version: number | null }>(changes.data)) {
    const cols = sealChange(r.tenant_id, r.interview_id, r.question_key, r.old_value, r.new_value);
    const back = openChange(r.tenant_id, { ...r, ...cols });
    if (!cols.sealed || "unreadable" in back || !same(back.old, r.old_value) || !same(back.new, r.new_value)) { out.failed++; continue; }
    const up = await client.rpc("seal_uw_answer_change", { p_id: r.id, p_sealed: cols.sealed, p_key_version: cols.key_version });
    if (up.error) out.failed++; else out.changes++;
  }

  const subs = await client.from("tenant_application_submissions").select("id, tenant_id, application_id, health_snapshot").not("health_snapshot", "eq", "{}").limit(400);
  if (subs.error) throw new Error(subs.error.message);
  for (const r of rows<{ id: string; tenant_id: string; application_id: string; health_snapshot: Record<string, unknown> }>(subs.data).filter((s) => typeof s.health_snapshot?.sealed !== "string").slice(0, 200)) {
    const sealedSnap = sealSnapshot(r.tenant_id, r.application_id, r.health_snapshot);
    if (typeof sealedSnap.sealed !== "string" || !same(openSnapshot(r.tenant_id, r.application_id, sealedSnap), r.health_snapshot)) { out.failed++; continue; }
    const up = await client.from("tenant_application_submissions").update({ health_snapshot: sealedSnap }).eq("tenant_id", r.tenant_id).eq("id", r.id);
    if (up.error) out.failed++; else out.snapshots++;
  }

  const left = await Promise.all([
    client.from("tenant_uw_answers").select("question_key", { count: "exact", head: true }).is("sealed", null).or("value.not.is.null,notes.not.is.null"),
    client.from("tenant_medications").select("id", { count: "exact", head: true }).is("sealed", null),
    client.from("tenant_uw_answer_changes").select("id", { count: "exact", head: true }).is("sealed", null),
  ]);
  out.remaining = left.reduce((n, r) => n + (r.count ?? 0), 0);
  return out;
}
