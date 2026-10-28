import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { readFoundRow, readHasPhone, type ExistenceRead, type SetupProfileFacts, type SetupProgress } from "./checklist";
import { hasImportedStatement } from "./summaries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenants.support_phone is not in database.types.ts yet (shared; not ours to regenerate)
const db = () => getSupabaseServiceClient() as any;

/** A read that throws (rather than returning an error) proves nothing either. */
async function proves(read: PromiseLike<ExistenceRead>, test: (result: ExistenceRead) => boolean): Promise<boolean> {
  try {
    return test(await read);
  } catch {
    return false;
  }
}

/**
 * "Finish a carrier so you can sell it": one carrier the agency added and has not switched off, with an
 * appointment in force — the carrier card's To finish list. The contract (level + writing number) is
 * optional since 2026-10-28 (owner: "ready to sell even without filling up these"), so a carrier counts
 * as added through either its contract row or its "contracted" switch.
 * Products are not read: a carrier's products are sold by default and only an owner unticking every
 * one of them would leave it unready, which the card itself still shows.
 */
async function hasCarrierReadyToSell(tenantId: string): Promise<boolean> {
  try {
    const [contracts, switches, appointed] = await Promise.all([
      db().from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId).eq("is_active", true).limit(200),
      db().from("tenant_carrier_requirements" as never).select("carrier_id, contracted").eq("tenant_id", tenantId).limit(500),
      db().from("appointments").select("carrier_id").eq("tenant_id", tenantId).is("terminated_at", null).limit(500),
    ]);
    if (contracts.error || switches.error || appointed.error) return false;
    const switchRows = (switches.data ?? []) as unknown as { carrier_id: string; contracted: boolean | null }[];
    const off = new Set(switchRows.filter((row) => row.contracted === false).map((row) => row.carrier_id));
    const added = new Set([
      ...((contracts.data ?? []) as { carrier_id: string }[]).map((row) => row.carrier_id),
      ...switchRows.filter((row) => row.contracted !== false).map((row) => row.carrier_id),
    ]);
    const withState = new Set(((appointed.data ?? []) as { carrier_id: string }[]).map((row) => row.carrier_id));
    return [...added].some((id) => !off.has(id) && withState.has(id));
  } catch {
    return false;
  }
}

/**
 * The setup checklist's per-step facts, for one tenant. Six cheap existence reads (`limit 1` or a
 * head count) run in parallel. Every read is filtered by the tenant: these go through the service
 * role, which has no RLS predicate, and an unfiltered read would walk every tenant's rows.
 */
export async function loadSetupProgress(tenantId: string): Promise<SetupProgress> {
  const [base, more] = await Promise.all([loadBaseProgress(tenantId), loadWalkthroughProgress(tenantId)]);
  return { ...base, ...more };
}

/**
 * The 2026-10-21 walkthrough's facts: team, outbound, inbound and the per-module settings. Same rules
 * as the base reads — tenant-filtered existence checks, in parallel, an error proves nothing. Each
 * table is the one the step's own screen writes (the settings rows are created on first save, so a
 * row means the owner has been through that screen).
 */
async function loadWalkthroughProgress(tenantId: string): Promise<SetupProgress> {
  const [
    teamInvited, leadsImported, callingWindowsSet, queueOwned, ruleActive, outcomesMapped, queueSlaSet,
    salesCarriersSet, disclosuresPublished, retentionSet, complianceSet, accountingSet, hierarchySet,
  ] = await Promise.all([
    // Invited or joined: the invite writes the membership row up front (accepted_at stays null until then).
    proves(db().from("tenant_users").select("user_id").eq("tenant_id", tenantId).neq("role", "owner").limit(1), readFoundRow),
    proves(db().from("agent_lead_import_batches").select("id").eq("tenant_id", tenantId).eq("status", "completed").limit(1), readFoundRow),
    proves(db().from("tenant_calling_windows").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(), readFoundRow),
    proves(db().from("lead_queue").select("id").eq("tenant_id", tenantId).not("owner_user_id", "is", null).limit(1), readFoundRow),
    proves(db().from("assignment_rules").select("id").eq("tenant_id", tenantId).eq("is_active", true).limit(1), readFoundRow),
    proves(db().from("stage_dispositions").select("id").eq("tenant_id", tenantId).limit(1), readFoundRow),
    proves(db().from("tenant_queue_sla_settings").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(), readFoundRow),
    hasCarrierReadyToSell(tenantId),
    // The agency's own wording, published — the platform rows (tenant_id null) do not count.
    proves(db().from("application_disclosures").select("id").eq("tenant_id", tenantId).eq("status", "published").limit(1), readFoundRow),
    proves(db().from("retention_settings").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(), readFoundRow),
    proves(db().from("retention_rule").select("id").eq("tenant_id", tenantId).limit(1), readFoundRow),
    proves(db().from("accounting_settings").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(), readFoundRow),
    proves(db().from("producer_hierarchy").select("id").eq("tenant_id", tenantId).not("parent_producer_id", "is", null).limit(1), readFoundRow),
  ]);
  return {
    teamInvited, leadsImported, callingWindowsSet, leadsAssigned: queueOwned || ruleActive, outcomesMapped, queueSlaSet,
    salesCarriersSet, disclosuresPublished, retentionSet, complianceSet, accountingSet, hierarchySet,
  };
}

/**
 * A member's own facts: what they did, not what the agency did. tenant_lead_activity records every
 * lead served to a person (the queue-claim trigger, LA-2.21) and the outcome they recorded on it.
 */
export async function loadMemberSetupProgress(tenantId: string, userId: string): Promise<SetupProgress> {
  const [leadServed, transferClaimed, outcomeRecorded] = await Promise.all([
    proves(db().from("tenant_lead_activity").select("id").eq("tenant_id", tenantId).eq("agent_user_id", userId).limit(1), readFoundRow),
    proves(db().from("tenant_lead_activity").select("id").eq("tenant_id", tenantId).eq("agent_user_id", userId).not("work_item_id", "is", null).limit(1), readFoundRow),
    proves(db().from("tenant_lead_activity").select("id").eq("tenant_id", tenantId).eq("agent_user_id", userId).not("dispositioned_at", "is", null).limit(1), readFoundRow),
  ]);
  return { leadServed, transferClaimed, outcomeRecorded };
}

/** This person's marks on their walkthrough (tenant_setup_guide). */
export type SetupGuideState = {
  skipped: string[];
  done: string[];
  hiddenAt: string | null;
  finishedAt: string | null;
  /** A row exists: the person has opened their walkthrough at least once. */
  exists: boolean;
};

export const EMPTY_GUIDE_STATE: SetupGuideState = { skipped: [], done: [], hiddenAt: null, finishedAt: null, exists: false };

/** A failed read (the table not migrated yet) is no marks: nothing skipped, nothing hidden. */
export async function loadSetupGuideState(tenantId: string, userId: string): Promise<SetupGuideState> {
  try {
    const { data, error } = await db().from("tenant_setup_guide").select("skipped_steps, done_steps, hidden_at, finished_at").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    if (error || !data) return EMPTY_GUIDE_STATE;
    return { skipped: data.skipped_steps ?? [], done: data.done_steps ?? [], hiddenAt: data.hidden_at ?? null, finishedAt: data.finished_at ?? null, exists: true };
  } catch {
    return EMPTY_GUIDE_STATE;
  }
}

/** Writes this person's marks (the whole row: the route reads, changes and writes back). */
export async function saveSetupGuideState(tenantId: string, userId: string, state: SetupGuideState): Promise<void> {
  const { error } = await db()
    .from("tenant_setup_guide")
    .upsert(
      { tenant_id: tenantId, user_id: userId, skipped_steps: state.skipped, done_steps: state.done, hidden_at: state.hiddenAt, finished_at: state.finishedAt },
      { onConflict: "tenant_id,user_id" },
    );
  if (error) throw new Error(`Could not save your setup progress: ${error.message}`);
}

/** A member's walkthrough, once finished, is stamped like the owner's and does not come back. */
export async function recordMemberSetupFinished(tenantId: string, userId: string, state: SetupGuideState): Promise<void> {
  if (state.finishedAt) return;
  try {
    await saveSetupGuideState(tenantId, userId, { ...state, finishedAt: new Date().toISOString() });
  } catch {
    // Not stamped: the next render tries again.
  }
}

async function loadBaseProgress(tenantId: string): Promise<SetupProgress> {
  const [carriersAdded, statementImported, appointmentsConfirmed, leadSourcesAdded, phoneAdded, bookImported, finished] = await Promise.all([
    proves(db().from("tenant_carriers").select("id").eq("tenant_id", tenantId).eq("is_active", true).limit(1), readFoundRow),
    hasImportedStatement(tenantId),
    // An agency appointment in force — the same rows the "Appointments" tile counts.
    proves(db().from("appointments").select("id").eq("tenant_id", tenantId).is("terminated_at", null).limit(1), readFoundRow),
    // Any publisher, marketing company or affiliate the agency has not offboarded.
    proves(db().from("partners").select("id").eq("tenant_id", tenantId).neq("status", "offboarded").limit(1), readFoundRow),
    // The phone on the agency profile tab (migration 20260924210000). The tenant's own row.
    proves(db().from("tenants").select("support_phone").eq("id", tenantId).maybeSingle(), readHasPhone),
    // The book import step (only when the business profile recommended it): any policy from the carrier files.
    proves(db().from("policy_current").select("policy_number").eq("tenant_id", tenantId).limit(1), readFoundRow),
    // LA-0.3's "does not come back": stamped once, the first time every step was done. Before the
    // column is migrated the read errors, which proves nothing — the checklist just follows the steps.
    proves(db().from("tenants").select("setup_checklist_completed_at").eq("id", tenantId).maybeSingle(), (read) =>
      readFoundRow(read) && (read?.data as { setup_checklist_completed_at?: unknown }).setup_checklist_completed_at != null,
    ),
  ]);
  return { carriersAdded, statementImported, appointmentsConfirmed, leadSourcesAdded, phoneAdded, bookImported, finished };
}

/**
 * The business profile saved at signup: the lead sources ticked and the setup steps recommended from
 * them. The checklist reads it to skip what the agency said it does not need (a referrals-only agent
 * has no lead sources to route). A failed read is no profile: every step the plan allows is shown.
 */
export async function loadSetupProfile(tenantId: string): Promise<SetupProfileFacts | null> {
  try {
    const { data, error } = await db().from("business_profiles").select("lead_sources, recommended_setup_steps").eq("tenant_id", tenantId).maybeSingle();
    if (error || !data) return null;
    return { leadSources: data.lead_sources ?? null, recommendedSetupSteps: data.recommended_setup_steps ?? null };
  } catch {
    return null;
  }
}

/**
 * Stamps the checklist finished, once. Called when a render finds every step done and no stamp;
 * `is null` makes a second, racing render a no-op, and a failure (column not migrated yet) only means
 * the next render tries again.
 */
export async function recordSetupFinished(tenantId: string): Promise<void> {
  try {
    await db().from("tenants").update({ setup_checklist_completed_at: new Date().toISOString() }).eq("id", tenantId).is("setup_checklist_completed_at", null);
  } catch {
    // Not stamped: the steps still hold, so the checklist stays hidden on the next render anyway.
  }
}
