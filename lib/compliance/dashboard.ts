import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { listComplaints, deadlineSetup } from "./complaintStore";
import { dashboardAlerts, dashboardTiles, type Figures, type GapLine, type Expiry } from "./dashboardCore";
import { bookGapScan } from "./evidenceReport";

/**
 * LA-6.7 (Notion sprint, Module 6 — Compliance) · the dashboard's figures, each read from the module
 * that owns it, live (no snapshot, no as-of time to explain). A source that is not set up yet comes
 * back null and the tile says "not configured" — it is never shown as zero.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type Viewer = { tenantId: string; userId: string; role: string };

const quiet = <T,>(p: Promise<T>): Promise<T | null> => p.catch((e) => { console.error("[compliance-dashboard]", e instanceof Error ? e.message : e); return null; });
// A failure is kept apart from "not set up": a scan that threw is reported as unchecked, not as no alerts.
const FAILED = Symbol("failed");
const attempt = <T,>(p: Promise<T>): Promise<T | typeof FAILED> => p.catch((e) => { console.error("[compliance-dashboard]", e instanceof Error ? e.message : e); return FAILED; });

export async function loadComplianceDashboard(viewer: Viewer, now = new Date()) {
  const [figures, scanResult, complaintsResult, licences, eo, coverage, settings] = await Promise.all([
    quiet(db().rpc("compliance_dashboard_figures", { p_tenant_id: viewer.tenantId }).then((r: Loose) => { if (r.error) throw new Error(r.error.message); return r.data as Figures; })),
    // Counts only, no personal data on this screen: the scan is not logged as a report here.
    attempt(bookGapScan(viewer, {}, { log: false, numbers: false })),
    attempt(listComplaints(viewer, { open: true })),
    quiet(db().from("licenses").select("state, expires_at").eq("tenant_id", viewer.tenantId).then((r: Loose) => r.data ?? [])),
    quiet(db().from("eo_policies").select("carrier, expires_at").eq("tenant_id", viewer.tenantId).then((r: Loose) => r.data ?? [])),
    quiet(deadlineSetup(viewer.tenantId)),
    quiet(db().from("compliance_settings").select("dashboard_hidden_tiles").eq("tenant_id", viewer.tenantId).maybeSingle().then((r: Loose) => r.data ?? null)),
  ]);
  const scan = scanResult === FAILED ? null : scanResult;
  const complaints = complaintsResult === FAILED ? null : complaintsResult;
  const gaps: GapLine[] | null = scan ? scan.lines.map((l) => ({ category: l.category, numbers: l.numbers, count: l.count, undeterminedCount: l.undeterminedCount, undeterminedReason: l.undeterminedReason })) : null;
  const expiries: Expiry[] = [
    ...((licences ?? []) as Loose[]).map((l) => ({ kind: "licence" as const, name: l.state as string, expiresAt: l.expires_at as string })),
    ...((eo ?? []) as Loose[]).map((e) => ({ kind: "eo" as const, name: (e.carrier as string) ?? "E&O", expiresAt: e.expires_at as string })),
  ];
  const alerts = dashboardAlerts({
    complaints: complaints ? complaints.map((c) => ({ id: c.id, channel: c.channel, regulatorState: c.regulatorState, tone: c.countdown.tone, daysLeft: c.countdown.daysLeft, label: c.countdown.label })) : null,
    gaps,
    expiries,
    hasEo: ((eo ?? []) as Loose[]).length > 0,
    deadlineCoverage: coverage?.available ? coverage.coverage : null,
    now,
    failed: { gaps: scanResult === FAILED, complaints: complaintsResult === FAILED },
    purgeSkipped: (figures as Figures | null)?.purge_live_skipped ?? null,
  });
  const hidden = (settings as Loose)?.dashboard_hidden_tiles;
  const tiles = dashboardTiles({ figures: (figures as Figures | null) ?? null, gaps, hidden: Array.isArray(hidden) ? hidden : [] });
  return { alerts, tiles, generatedAt: now.toISOString(), complaintsAvailable: complaints !== null };
}
