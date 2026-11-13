import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { deadlineSetup } from "@/lib/compliance/complaintStore";
import { listHolds, listRules, listRuns } from "@/lib/compliance/retentionStore";
import { listReconciliations } from "@/lib/compliance/recordIndex";
import {
  copyPlatformRule,
  deleteTenantRule,
  DEFAULTS,
  loadComplianceSettings,
  PLATFORM_CAPS,
  recentChanges,
  saveSettings,
  saveTenantRule,
  setDeadline,
  SettingsError,
} from "@/lib/compliance/settingsStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.8 (Notion sprint) · compliance settings: read everything LA-6 reads, and change it. Tenant
 * admin only; every value is validated here (and again by the database), and every change audited.
 */
const op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("settings"), patch: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal("deadline"), regulator: z.string(), response_days: z.number().int().nullable(), notes: z.string().max(500).nullable().optional() }).strict(),
  z.object({ op: z.literal("rule"), record_type: z.string(), state: z.string().nullable(), retain_days: z.number().int(), action: z.string(), basis: z.string(), notes: z.string().max(500).nullable().optional() }).strict(),
  z.object({ op: z.literal("delete_rule"), id: z.string().uuid() }).strict(),
  z.object({ op: z.literal("copy_rule"), record_type: z.string() }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof SettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[compliance-settings]", error);
  return NextResponse.json({ error: "The settings could not be saved" }, { status: 500 });
};

async function bundle(tenantId: string) {
  const db = getSupabaseServiceClient();
  const [settings, deadlines, rules, holds, runs, changes, team, indexChecks, openByRegulator] = await Promise.all([
    loadComplianceSettings(tenantId),
    deadlineSetup(tenantId),
    listRules(tenantId).catch(() => []),
    listHolds(tenantId).catch(() => []),
    listRuns(tenantId, 10).catch(() => []),
    recentChanges(tenantId),
    db.from("tenant_users").select("user_id, role, users!inner(name, email)").eq("tenant_id", tenantId).not("accepted_at", "is", null),
    // LA-6.1 (round 7): the nightly index checks, newest first; a non-zero missing count is a bug.
    listReconciliations(tenantId, 14).catch(() => []),
    // Round 8 (money-compliance-settings board §6): each regulator's open complaints, beside its deadline. A count
    // that cannot be read leaves the column on "—".
    openComplaintsByRegulator(tenantId).catch(() => null),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = ((team.data ?? []) as any[]).map((m) => ({ id: m.user_id as string, role: m.role as string, name: (m.users?.name as string | null) ?? (m.users?.email as string) ?? "Unnamed" }));
  return { settings, defaults: DEFAULTS, caps: PLATFORM_CAPS, deadlines, rules, holds, runs, changes, team: people, indexChecks, openByRegulator };
}

/** Open regulator complaints (a state DOI's or the FTC's, not yet resolved), counted by regulator: "TX", "FTC". */
async function openComplaintsByRegulator(tenantId: string): Promise<Record<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getSupabaseServiceClient() as any).from("complaint").select("channel, regulator_state").eq("tenant_id", tenantId).in("channel", ["doi", "ftc"]).neq("status", "resolved").limit(5000);
  if (error) throw new Error(error.message);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { channel: string; regulator_state: string | null }[]) {
    const key = row.channel === "ftc" ? "FTC" : row.regulator_state;
    if (key) out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export async function GET() {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await bundle(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = op.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the change and try again." }, { status: 400 });
  const b = parsed.data;
  const { tenantId, userId } = auth.context;
  try {
    if (b.op === "settings") await saveSettings(tenantId, userId, b.patch);
    else if (b.op === "deadline") await setDeadline(tenantId, userId, b.regulator, b.response_days, b.notes ?? null);
    else if (b.op === "rule") await saveTenantRule(tenantId, userId, { recordType: b.record_type, state: b.state, retainDays: b.retain_days, action: b.action, basis: b.basis, notes: b.notes ?? null });
    else if (b.op === "delete_rule") await deleteTenantRule(tenantId, userId, b.id);
    else await copyPlatformRule(tenantId, userId, b.record_type);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.settings_saved", targetType: "compliance_settings", targetId: tenantId, metadata: { op: b.op, keys: b.op === "settings" ? Object.keys(b.patch) : undefined }, request });
    return NextResponse.json(await bundle(tenantId));
  } catch (error) {
    return fail(error);
  }
}
