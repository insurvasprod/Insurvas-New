import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { VERIFICATION_METHODS } from "./dataSubject";
import { TILE_KEYS } from "./dashboardCore";
import { GAP_KEYS } from "./evidenceGaps";
import { ACTIONS, BASES, RECORD_TYPE_KEYS } from "./retention";
import { placeHold, releaseHold } from "./retentionStore";

/**
 * LA-6.8 (Notion sprint, Module 6 — Compliance) · every LA-6 setting, server side. Each consumer
 * reads its values from compliance_settings (or the rule and deadline tables), never from the client.
 * Every change writes compliance_setting_change: who, what, from, to, when.
 *
 * Platform caps are not settings: the 3-day deletion hold floor, the locked-on litigator and
 * internal-DNC gate checks, and the never-delete rule for the do-not-call list. The database refuses
 * each of them too.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const SETTINGS_PENDING_MESSAGE = "Compliance settings need a database update (20261015110000–20261015170000).";
export const PLATFORM_CAPS = {
  deletionHoldFloorDays: 3,
  lockedGateChecks: ["tcpa_litigator", "internal_dnc"],
  neverDelete: ["internal_dnc"],
} as const;

export class SettingsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SettingsError";
  }
}

function check(error: { code?: string; message: string } | null) {
  if (error && (isSchemaGap(error) || error.code === "PGRST202")) throw new SettingsError(SETTINGS_PENDING_MESSAGE, 503);
  if (error?.code === "23514") throw new SettingsError("That value is outside what is allowed.", 400);
  if (error) throw new Error(error.message);
}

export type ComplianceSettings = {
  gate: { consentMissing: "warn" | "block"; timeoutMs: number; federalDnc: boolean; consent: boolean; existingCustomer: boolean; callingHours: boolean };
  complaints: { amberDays: number; redDays: number };
  deletion: { holdDays: number; methods: string[]; performerRoles: string[] };
  purge: { scheduleEnabled: boolean; windowDays: number; recipients: string[] };
  report: { roles: string[]; gapChecks: string[] };
  dashboard: { hiddenTiles: string[]; monthlyEmail: boolean; recipients: string[] };
};

export const DEFAULTS: ComplianceSettings = {
  gate: { consentMissing: "warn", timeoutMs: 2000, federalDnc: true, consent: true, existingCustomer: true, callingHours: true },
  complaints: { amberDays: 10, redDays: 5 },
  deletion: { holdDays: 7, methods: [...VERIFICATION_METHODS], performerRoles: ["owner"] },
  purge: { scheduleEnabled: false, windowDays: 7, recipients: [] },
  report: { roles: ["owner", "producer"], gapChecks: [...GAP_KEYS] },
  dashboard: { hiddenTiles: [], monthlyEmail: true, recipients: [] },
};

const COLUMN: Record<string, { section: string; column: string }> = {
  "gate.consentMissing": { section: "transfer_gate", column: "gate_consent_missing" },
  "gate.timeoutMs": { section: "transfer_gate", column: "gate_timeout_ms" },
  "gate.federalDnc": { section: "transfer_gate", column: "gate_check_federal_dnc" },
  "gate.consent": { section: "transfer_gate", column: "gate_check_consent" },
  "gate.existingCustomer": { section: "transfer_gate", column: "gate_check_existing_customer" },
  "gate.callingHours": { section: "transfer_gate", column: "gate_check_calling_hours" },
  "complaints.amberDays": { section: "complaint_deadlines", column: "complaint_amber_days" },
  "complaints.redDays": { section: "complaint_deadlines", column: "complaint_red_days" },
  "deletion.holdDays": { section: "deletion_requests", column: "deletion_hold_days" },
  "deletion.methods": { section: "deletion_requests", column: "deletion_methods" },
  "deletion.performerRoles": { section: "deletion_requests", column: "deletion_performer_roles" },
  "purge.scheduleEnabled": { section: "purge_job", column: "purge_schedule_enabled" },
  "purge.windowDays": { section: "purge_job", column: "purge_dry_run_window_days" },
  "purge.recipients": { section: "purge_job", column: "purge_summary_recipients" },
  "report.roles": { section: "evidence_report", column: "report_roles" },
  "report.gapChecks": { section: "evidence_report", column: "report_gap_checks" },
  "dashboard.hiddenTiles": { section: "dashboard", column: "dashboard_hidden_tiles" },
  "dashboard.monthlyEmail": { section: "dashboard", column: "dashboard_monthly_email" },
  "dashboard.recipients": { section: "dashboard", column: "dashboard_email_recipients" },
};

export async function loadComplianceSettings(tenantId: string): Promise<ComplianceSettings> {
  const { data, error } = await db().from("compliance_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error && !isSchemaGap(error)) throw new Error(error.message);
  const r = (data ?? {}) as Loose;
  const pick = <T,>(v: unknown, d: T): T => (v === undefined || v === null ? d : (v as T));
  return {
    gate: { consentMissing: pick(r.gate_consent_missing, DEFAULTS.gate.consentMissing), timeoutMs: pick(r.gate_timeout_ms, DEFAULTS.gate.timeoutMs), federalDnc: pick(r.gate_check_federal_dnc, true), consent: pick(r.gate_check_consent, true), existingCustomer: pick(r.gate_check_existing_customer, true), callingHours: pick(r.gate_check_calling_hours, true) },
    complaints: { amberDays: pick(r.complaint_amber_days, 10), redDays: pick(r.complaint_red_days, 5) },
    deletion: { holdDays: pick(r.deletion_hold_days, 7), methods: pick(r.deletion_methods, DEFAULTS.deletion.methods), performerRoles: pick(r.deletion_performer_roles, ["owner"]) },
    purge: { scheduleEnabled: pick(r.purge_schedule_enabled, false), windowDays: pick(r.purge_dry_run_window_days, 7), recipients: pick(r.purge_summary_recipients, []) },
    report: { roles: pick(r.report_roles, ["owner", "producer"]), gapChecks: pick(r.report_gap_checks, DEFAULTS.report.gapChecks) },
    dashboard: { hiddenTiles: pick(r.dashboard_hidden_tiles, []), monthlyEmail: pick(r.dashboard_monthly_email, true), recipients: pick(r.dashboard_email_recipients, []) },
  };
}

const subset = (value: unknown, allowed: readonly string[], label: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !allowed.includes(v))) throw new SettingsError(`${label}: choose from the list.`, 400);
  return [...new Set(value as string[])];
};
const intIn = (value: unknown, lo: number, hi: number, label: string) => {
  if (!Number.isInteger(value) || (value as number) < lo || (value as number) > hi) throw new SettingsError(`${label} must be a whole number from ${lo} to ${hi}.`, 400);
  return value as number;
};
const bool = (value: unknown, label: string) => {
  if (typeof value !== "boolean") throw new SettingsError(`${label}: yes or no.`, 400);
  return value;
};
const uuids = (value: unknown, label: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v))) throw new SettingsError(`${label}: choose people from the team.`, 400);
  return [...new Set(value as string[])].slice(0, 20);
};

/** Validate one setting's new value. Caps are enforced here and again by the database. */
export function validateSetting(key: string, value: unknown): unknown {
  switch (key) {
    case "gate.consentMissing":
      if (value !== "warn" && value !== "block") throw new SettingsError("A missing consent artefact warns or blocks.", 400);
      return value;
    case "gate.timeoutMs": return intIn(value, 500, 10000, "The time budget (ms)");
    case "gate.federalDnc": case "gate.consent": case "gate.existingCustomer": case "gate.callingHours": return bool(value, "That check");
    case "complaints.amberDays": return intIn(value, 1, 90, "Amber");
    case "complaints.redDays": return intIn(value, 1, 60, "Red");
    case "deletion.holdDays": return intIn(value, PLATFORM_CAPS.deletionHoldFloorDays, 45, "The deletion hold");
    case "deletion.methods": {
      const v = subset(value, VERIFICATION_METHODS, "Verification methods");
      if (!v.length) throw new SettingsError("Keep at least one way to verify identity.", 400);
      return v;
    }
    case "deletion.performerRoles": case "report.roles": {
      const v = subset(value, ["owner", "producer"], "Who may");
      if (!v.includes("owner")) throw new SettingsError("The tenant admin always may.", 400);
      return v;
    }
    case "purge.scheduleEnabled": case "dashboard.monthlyEmail": return bool(value, "That switch");
    case "purge.windowDays": return intIn(value, 1, 30, "The dry-run window (days)");
    case "purge.recipients": case "dashboard.recipients": return uuids(value, "Recipients");
    case "report.gapChecks": return subset(value, GAP_KEYS, "Gap checks");
    case "dashboard.hiddenTiles": return subset(value, TILE_KEYS, "Tiles");
    default:
      // Includes any attempt to switch off a locked gate check: there is no such setting.
      throw new SettingsError("That is not a setting you can change.", 400);
  }
}

async function logChange(tenantId: string, userId: string, section: string, setting: string, from: unknown, to: unknown) {
  const { error } = await db().from("compliance_setting_change").insert({ tenant_id: tenantId, section, setting, old_value: from === undefined ? null : from, new_value: to === undefined ? null : to, changed_by: userId });
  check(error);
}

/** Change settings. Each changed value is validated, saved, and audited with its old value. */
export async function saveSettings(tenantId: string, userId: string, patch: Record<string, unknown>) {
  const current = await loadComplianceSettings(tenantId);
  const flat: Record<string, unknown> = {};
  for (const [section, values] of Object.entries(current)) for (const [k, v] of Object.entries(values)) flat[`${section}.${k}`] = v;
  const row: Record<string, unknown> = {};
  const changes: { key: string; from: unknown; to: unknown }[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const value = validateSetting(key, raw);
    if (JSON.stringify(flat[key]) === JSON.stringify(value)) continue;
    row[COLUMN[key].column] = value;
    changes.push({ key, from: flat[key], to: value });
  }
  const amber = (row.complaint_amber_days as number | undefined) ?? current.complaints.amberDays;
  const red = (row.complaint_red_days as number | undefined) ?? current.complaints.redDays;
  if (red > amber) throw new SettingsError("Red must come at or after amber (fewer days left).", 400);
  if (!changes.length) return current;
  // One transaction (compliance_settings_save, 20261015630000): the values and their change rows are
  // saved together or not at all — a setting is never changed without its record.
  const { error } = await db().rpc("compliance_settings_save", {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_row: row,
    p_changes: changes.map((c) => ({ section: COLUMN[c.key].section, setting: c.key, old_value: c.from === undefined ? null : c.from, new_value: c.to === undefined ? null : c.to })),
  });
  check(error);
  return loadComplianceSettings(tenantId);
}

// ── complaint deadlines ──
export async function setDeadline(tenantId: string, userId: string, regulator: string, days: number | null, notes: string | null) {
  if (!/^([A-Z]{2}|FTC)$/.test(regulator)) throw new SettingsError("Choose a state or the FTC.", 400);
  const { data: before } = await db().from("compliance_complaint_deadline").select("response_days, notes").eq("tenant_id", tenantId).eq("regulator", regulator).maybeSingle();
  if (days === null) {
    const { error } = await db().from("compliance_complaint_deadline").delete().eq("tenant_id", tenantId).eq("regulator", regulator);
    check(error);
  } else {
    intIn(days, 1, 180, "Response days");
    const { error } = await db().from("compliance_complaint_deadline").upsert({ tenant_id: tenantId, regulator, response_days: days, notes: notes?.trim() || null, set_by: userId, set_at: new Date().toISOString() }, { onConflict: "tenant_id,regulator" });
    check(error);
  }
  await logChange(tenantId, userId, "complaint_deadlines", regulator, before ?? null, days === null ? null : { response_days: days, notes });
}

// ── retention rules ──
export async function saveTenantRule(tenantId: string, userId: string, input: { recordType: string; state: string | null; retainDays: number | null; action: string; basis: string; notes: string | null }) {
  if (!(RECORD_TYPE_KEYS as readonly string[]).includes(input.recordType)) throw new SettingsError("Choose a record type.", 400);
  if (PLATFORM_CAPS.neverDelete.includes(input.recordType as "internal_dnc")) throw new SettingsError("Do-not-call entries are never deleted. That rule is locked.", 400);
  if (!(ACTIONS as readonly string[]).includes(input.action) || input.action === "never_delete") throw new SettingsError("Choose delete or anonymise.", 400);
  if (!(BASES as readonly string[]).includes(input.basis)) throw new SettingsError("Say where the period comes from.", 400);
  if (input.state !== null && !/^[A-Z]{2}$/.test(input.state)) throw new SettingsError("Choose a state, or all states.", 400);
  const days = intIn(input.retainDays, 30, 7300, "Retention days");
  let q = db().from("retention_rule").select("id, retain_days, action, basis, notes").eq("tenant_id", tenantId).eq("record_type", input.recordType);
  q = input.state ? q.eq("state", input.state) : q.is("state", null);
  const { data: before } = await q.maybeSingle();
  const values = { retain_days: days, action: input.action, basis: input.basis, notes: input.notes?.trim() || null, set_by: userId, set_at: new Date().toISOString() };
  const { error } = before
    ? await db().from("retention_rule").update(values).eq("id", before.id)
    : await db().from("retention_rule").insert({ tenant_id: tenantId, record_type: input.recordType, state: input.state, ...values });
  check(error);
  await logChange(tenantId, userId, "retention_rules", `${input.recordType}${input.state ? `:${input.state}` : ""}`, before ?? null, { retain_days: days, action: input.action, basis: input.basis, notes: values.notes });
}

export async function deleteTenantRule(tenantId: string, userId: string, id: string) {
  const { data: before } = await db().from("retention_rule").select("record_type, state, retain_days, action, basis").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!before) throw new SettingsError("That rule isn't yours to remove.", 404);
  const { error } = await db().from("retention_rule").delete().eq("tenant_id", tenantId).eq("id", id);
  check(error);
  await logChange(tenantId, userId, "retention_rules", `${before.record_type}${before.state ? `:${before.state}` : ""}`, before, null);
}

/** Copy the platform default for a record type to the tenant, to edit from there. */
export async function copyPlatformRule(tenantId: string, userId: string, recordType: string) {
  const { data: platform } = await db().from("retention_rule").select("retain_days, action, basis, notes").is("tenant_id", null).eq("record_type", recordType).is("state", null).maybeSingle();
  if (!platform) throw new SettingsError("There is no platform default for that type.", 404);
  if (platform.action === "never_delete") throw new SettingsError("Do-not-call entries are never deleted. That rule is locked.", 400);
  await saveTenantRule(tenantId, userId, { recordType, state: null, retainDays: platform.retain_days, action: platform.action, basis: platform.basis, notes: platform.notes });
}

// ── holds (logged here as settings changes too) ──
export async function placeHoldLogged(tenantId: string, userId: string, input: { scope: string; value: string | null; reason: string; note: string | null }) {
  await placeHold(tenantId, userId, input);
  await logChange(tenantId, userId, "legal_holds", `place:${input.scope}`, null, { scope: input.scope, reason: input.reason, note: input.note });
}
export async function releaseHoldLogged(tenantId: string, userId: string, id: string, note: string) {
  await releaseHold(tenantId, userId, id, note);
  await logChange(tenantId, userId, "legal_holds", `release:${id}`, { active: true }, { active: false, note });
}

export async function recentChanges(tenantId: string, limit = 50) {
  const { data } = await db().from("compliance_setting_change").select("section, setting, old_value, new_value, changed_by, changed_at").eq("tenant_id", tenantId).order("changed_at", { ascending: false }).limit(limit);
  return ((data ?? []) as Loose[]).map((c) => ({ section: c.section as string, setting: c.setting as string, from: c.old_value, to: c.new_value, by: c.changed_by as string | null, at: c.changed_at as string }));
}
