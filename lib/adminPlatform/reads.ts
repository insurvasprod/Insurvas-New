import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import type { PlatformQueues } from "@/lib/adminPlatform/needs";
import { platformStepsFor } from "@/lib/adminPlatform/steps";
import { getCallingRulesBoard } from "@/lib/callingWindow/rulesAdmin";
import { dialingPosture, unreachableVendors } from "@/lib/compliance/registryView";
import { getComplianceRegistry } from "@/lib/compliance/service";
import { emailConfigProblems, emailDeliveryMode } from "@/lib/email/transport";
import { fetchLegalDrafts } from "@/lib/legal/admin";
import { LEGAL_DOC_TYPES } from "@/lib/legal/constants";
import { fetchProducts } from "@/lib/products/queries";
import { getAllSettings } from "@/lib/settings/queries";
import { canManageSettingKey } from "@/lib/settings/restrictions";
import { buildCoverageRows, productScope, summarize } from "@/lib/stateDisclosures/board";
import { listProposals } from "@/lib/stateDisclosures/review";
import { listStateDisclosures } from "@/lib/stateDisclosures/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { announcementState } from "@/lib/system/adminFormat";
import { loadSystemAdminView } from "@/lib/system/adminView";
import { MAINTENANCE_LEVEL_LABELS } from "@/lib/system/constants";

type Viewer = { id: string; role: AdminRole };

/** A queue's read: undefined when the role may not open its page, null (logged) when the read failed. */
async function queue<T>(open: boolean, label: string, load: () => Promise<T>): Promise<T | null | undefined> {
  if (!open) return undefined;
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-platform] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Compliance: the page's own registry read and the dial gate's verdict (registryView.ts), never recomputed. */
async function complianceQueue(): Promise<NonNullable<PlatformQueues["compliance"]>> {
  const { vendors, dialing } = await getComplianceRegistry();
  return {
    registered: vendors.length,
    enabled: vendors.filter((vendor) => vendor.is_enabled).length,
    unreachable: unreachableVendors(vendors).length,
    blocked: dialingPosture(vendors, dialing).tone === "error",
    demo: dialing.demo,
  };
}

/** Disclosures: the board's own model (board.ts) over the page's own reads, so the counts match the page. */
async function disclosuresQueue(): Promise<NonNullable<PlatformQueues["disclosures"]>> {
  const [disclosures, products, proposals] = await Promise.all([
    listStateDisclosures(),
    fetchProducts({ includeArchived: false }).catch(() => []),
    listProposals(1),
  ]);
  const scope = productScope(products.map((product) => ({ code: product.code, name: product.name })), disclosures);
  const summary = summarize(buildCoverageRows(disclosures, scope, proposals.pending), scope.length);
  return {
    pending: proposals.pending.length,
    // Pending proposals come oldest first (review.ts listProposals).
    oldestPending: proposals.pending[0]?.proposed_at ?? null,
    placeholders: summary.placeholders,
    uncovered: summary.uncovered,
    statesCovered: summary.statesCovered,
    available: proposals.available,
  };
}

async function callingQueue(): Promise<NonNullable<PlatformQueues["calling"]>> {
  const { feed } = await getCallingRulesBoard();
  return { stale: feed?.stale ?? false, reviewedAt: feed?.lastRefreshedAt ?? null, staleAfterDays: feed?.staleAfterDays ?? null };
}

/** Mail: names only, as the Mail setup page (emailConfigProblems never returns a value). */
async function mailQueue(): Promise<NonNullable<PlatformQueues["mail"]>> {
  return { smtp: emailDeliveryMode() === "smtp", missing: emailConfigProblems().filter((name) => !name.startsWith("EMAIL_DELIVERY_MODE")) };
}

async function maintenanceQueue(): Promise<NonNullable<PlatformQueues["maintenance"]>> {
  const view = await loadSystemAdminView();
  const level = view.status.level;
  const nowMs = new Date(view.nowIso).getTime();
  return {
    on: level === "off" ? null : MAINTENANCE_LEVEL_LABELS[level],
    // A level saved for later is configured but not yet in force (as the Maintenance page reads it).
    scheduled: level === "off" && view.status.configuredLevel ? MAINTENANCE_LEVEL_LABELS[view.status.configuredLevel] : null,
    announcementsLive: view.announcementsError ? null : view.announcements.filter((item) => announcementState(item, nowMs) === "live").length,
  };
}

async function advancedQueue(role: AdminRole): Promise<NonNullable<PlatformQueues["advanced"]>> {
  const shown = (await getAllSettings()).filter((setting) => canManageSettingKey(role, setting.def.key));
  return { settings: shown.length, overridden: shown.filter((setting) => setting.isOverridden).length };
}

/**
 * Admin users: head counts only. Two-factor is "not enrolled" when `totp_secret` is the empty string
 * (lib/adminAuth/session.ts isTotpEnrolled); the filter compares it in the database and the secret is never read.
 */
async function adminsQueue(): Promise<NonNullable<PlatformQueues["admins"]>> {
  const db = getSupabaseServiceClient();
  const [active, supers, noTwoFactor] = await Promise.all([
    db.from("admin_users").select("id", { count: "exact", head: true }).eq("is_active", true),
    db.from("admin_users").select("id", { count: "exact", head: true }).eq("is_active", true).eq("role", "super_admin"),
    db.from("admin_users").select("id", { count: "exact", head: true }).eq("is_active", true).eq("totp_secret", ""),
  ]);
  for (const read of [active, supers, noTwoFactor]) if (read.error) throw new Error(read.error.message);
  return { active: active.count ?? 0, activeSuperAdmins: supers.count ?? 0, noTwoFactor: noTwoFactor.count ?? 0 };
}

async function legalQueue(): Promise<NonNullable<PlatformQueues["legal"]>> {
  const { drafts, supported } = await fetchLegalDrafts();
  const docs = LEGAL_DOC_TYPES.filter((type) => drafts.some((draft) => draft.doc_type === type));
  return { drafts: drafts.length, docs: [...docs], supported };
}

/**
 * Every Platform queue the viewer's role may open, read at once (each page's own loader, so the counts match the
 * pages), each failing on its own. Shared by the workspace and the rail's badge route.
 */
export async function platformQueues(viewer: Viewer): Promise<PlatformQueues> {
  const steps = new Set<string>(platformStepsFor(viewer.role).map((step) => step.key));
  const [compliance, disclosures, calling, mail, maintenance, advanced, admins, legal] = await Promise.all([
    queue(steps.has("compliance"), "compliance", complianceQueue),
    queue(steps.has("disclosures"), "disclosures", disclosuresQueue),
    queue(steps.has("calling"), "calling rules", callingQueue),
    queue(steps.has("mail"), "mail", mailQueue),
    queue(steps.has("maintenance"), "maintenance", maintenanceQueue),
    queue(steps.has("advanced"), "advanced", () => advancedQueue(viewer.role)),
    queue(steps.has("admins"), "admin users", adminsQueue),
    queue(steps.has("legal"), "legal drafts", legalQueue),
  ]);
  return { compliance, disclosures, calling, mail, maintenance, advanced, admins, legal };
}
