import "server-only";

import { contextRoles, type TenantContext } from "@/lib/tenantAuth/requireTenant";

import { getEntitlement } from "@/lib/entitlements/get";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

import { applicableSetupSteps, setupChecklistForState, type SetupAudience, type SetupChecklist } from "./checklist";
import {
  loadMemberSetupProgress,
  loadSetupGuideState,
  loadSetupProfile,
  loadSetupProgress,
  recordMemberSetupFinished,
  recordSetupFinished,
  type SetupGuideState,
} from "./setupProgress";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenants.setup_checklist_completed_at is not in database.types.ts yet (as in setupProgress.ts)
const db = () => getSupabaseServiceClient() as any;

/** The two finished stamps the sidebar needs, keyed by the session alone. */
export type SetupStamps = { ownerFinished: boolean; memberFinished: boolean };

/**
 * For the shell: both stamps in one parallel pair of reads, keyed by the session's ids so the shell
 * starts it beside its other reads (no extra round trip on every page). The full progress is only
 * read on the setup page, the dashboard and the guide bar. A read that fails counts as finished, so
 * an outage never adds a menu item.
 */
export async function readSetupStamps(tenantId: string, userId: string): Promise<SetupStamps> {
  const [tenant, guide] = await Promise.all([
    Promise.resolve(db().from("tenants").select("setup_checklist_completed_at").eq("id", tenantId).maybeSingle()).catch(() => null),
    Promise.resolve(db().from("tenant_setup_guide").select("finished_at").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle()).catch(() => null),
  ]);
  const ownerFinished = !tenant || tenant.error || !tenant.data ? true : tenant.data.setup_checklist_completed_at != null;
  // No row yet is a member who has not started: open. An error (table not migrated) is finished.
  const memberFinished = !guide || guide.error ? true : guide.data?.finished_at != null;
  return { ownerFinished, memberFinished };
}

/** Whether the sidebar offers "Get set up". A member with no steps for their role has nothing to open. */
export function setupStillOpen(stamps: SetupStamps, context: TenantContext, available: readonly string[]): boolean {
  if (context.role === "owner") return !stamps.ownerFinished;
  if (stamps.memberFinished) return false;
  return applicableSetupSteps({ features: available, audience: "member", roles: contextRoles(context), hiddenPages: context.hiddenPages }).length > 0;
}

/**
 * Where an invited member lands on their first sign-in: their walkthrough, when they have steps and
 * have never opened it (no tenant_setup_guide row — the setup page writes one on first visit). The
 * owner is sent there by checkout instead, and finds the dashboard card after that. Any failure is
 * null: the caller's usual landing.
 */
export async function firstLoginLanding(tenantId: string, userId: string, role: string): Promise<string | null> {
  if (role === "owner") return null;
  try {
    const [guide, entitlement] = await Promise.all([
      db().from("tenant_setup_guide").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
      getEntitlement(tenantId),
    ]);
    if (guide.error || guide.data) return null;
    const steps = applicableSetupSteps({ features: entitlement.features, audience: "member", roles: [role] });
    return steps.length > 0 ? "/app/setup" : null;
  } catch {
    return null;
  }
}

/** The sidebar entry for the walkthrough, added by the shell while it is open (not part of AGENT_MENU: no plan grants it). */
export const SETUP_MENU_ITEM = {
  key: "home.setup",
  label: "Get set up",
  navLabel: "Get set up",
  path: "/app/setup",
  icon: "list-checks",
  section: "Home",
  built: true,
} as const;

/**
 * Docs (owner, 2026-11-13): help getting set up in insurance and in Insurvas, for everyone. Added by the shell
 * beside Get set up rather than in AGENT_MENU, as no plan grants it and no role is refused it.
 */
export const DOCS_MENU_ITEM = {
  key: "home.docs",
  label: "Docs",
  navLabel: "Docs",
  path: "/app/docs",
  icon: "book-open",
  section: "Home",
  built: true,
} as const;

export type ViewerSetup = {
  audience: SetupAudience;
  checklist: SetupChecklist;
  guide: SetupGuideState;
  /** Finished for good (stamped), or there was nothing to set up: no card, no menu item, no landing. */
  closed: boolean;
};

/**
 * The walkthrough's reads, started from the signed session's two ids before the membership read comes back
 * (speed pass 2026-11-18: /api/app/setup made four trips in a row, 0.8 s, and now makes one). Every read is
 * filtered by the tenant and, where it is the person's own, the user; nothing is returned to anyone until the
 * caller has checked the membership. `audience` unknown (the route, before the role is read) starts both sets:
 * the owner's set is thirty `limit 1` probes, about the cost of one round trip together. Each set starts once.
 */
export type ViewerSetupReads = {
  owner: () => Promise<[Awaited<ReturnType<typeof loadSetupProgress>>, Awaited<ReturnType<typeof loadSetupProfile>>, boolean]>;
  member: () => Promise<Awaited<ReturnType<typeof loadMemberSetupProgress>>>;
  guide: Promise<SetupGuideState>;
};

export function startViewerSetupReads(tenantId: string, userId: string, audience?: SetupAudience): ViewerSetupReads {
  let owner: ReturnType<ViewerSetupReads["owner"]> | null = null;
  let member: ReturnType<ViewerSetupReads["member"]> | null = null;
  const reads: ViewerSetupReads = {
    owner: () => (owner ??= Promise.all([
      loadSetupProgress(tenantId),
      loadSetupProfile(tenantId),
      // Solo mode: no "Assign leads to your agents" step for an agent working alone.
      isSoloWorkspace(tenantId),
    ])),
    member: () => (member ??= loadMemberSetupProgress(tenantId, userId)),
    guide: loadSetupGuideState(tenantId, userId),
  };
  // Started now; a set the caller turns out not to need is left unobserved, so its failure must not surface.
  if (audience !== "member") reads.owner().catch(() => undefined);
  if (audience !== "owner") reads.member().catch(() => undefined);
  return reads;
}

/**
 * The walkthrough for the person reading: the owner (an agency admin counts — their base role is
 * owner) gets the agency's setup, gated by the plan; anyone else gets their own short list, gated by
 * plan, role and hidden pages. `available` is the plan's features after kill switches, as the menu
 * uses them.
 *
 * Call `afterResponse(() => viewer.stamp())` when it returns `needsStamp`: the first render that finds
 * everything done or skipped closes the walkthrough for good (LA-0.3).
 */
export async function loadViewerSetup(
  context: TenantContext,
  available: readonly string[],
  seats: number | null | undefined,
  /** Reads started earlier from the session (startViewerSetupReads), so they ran beside the caller's own. */
  started?: ViewerSetupReads,
): Promise<ViewerSetup & { needsStamp: boolean; stamp: () => Promise<void> }> {
  const audience: SetupAudience = context.role === "owner" ? "owner" : "member";
  const reads = started ?? startViewerSetupReads(context.tenantId, context.userId, audience);
  if (audience === "owner") {
    const [[progress, profile, solo], guide] = await Promise.all([reads.owner(), reads.guide]);
    const checklist = setupChecklistForState("", progress, { features: available, profile, seats, marks: guide, solo });
    const finished = progress.finished === true;
    return {
      audience,
      checklist,
      guide,
      closed: finished || checklist.total === 0,
      needsStamp: checklist.total > 0 && checklist.complete && !finished,
      stamp: () => recordSetupFinished(context.tenantId),
    };
  }
  const [progress, guide] = await Promise.all([reads.member(), reads.guide]);
  const finished = guide.finishedAt !== null;
  const checklist = setupChecklistForState("", { ...progress, finished }, {
    features: available,
    audience,
    roles: contextRoles(context),
    hiddenPages: context.hiddenPages,
    marks: guide,
  });
  return {
    audience,
    checklist,
    guide,
    closed: finished || checklist.total === 0,
    needsStamp: checklist.total > 0 && checklist.complete && !finished,
    stamp: () => recordMemberSetupFinished(context.tenantId, context.userId, guide),
  };
}
