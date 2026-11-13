import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { nextSetupStep, setupChecklistForState, type SetupChecklist } from "./checklist";
import { loadMemberSetupProgress, loadSetupProfile, loadSetupProgress } from "./setupProgress";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenant_setup_guide is not in database.types.ts yet (as in setupProgress.ts)
const db = () => getSupabaseServiceClient() as any;

export type TeamSetupRow = {
  userId: string | null;
  name: string;
  email: string | null;
  role: string;
  /** Invited and not joined yet: their setup has not started. */
  invited: boolean;
  done: number;
  total: number;
  next: string | null;
  finished: boolean;
};

/**
 * Team setup (owner, 2026-11-12/13: "the owner should see the progress of the setup of his employees to see if
 * everyone is already finished setting up Insurvas"), a sub-page of the agency dashboard. One row for the
 * agency's own setup, then one per person: how far through their Get started they are and their next step.
 * The same checklist each person sees (checklist.ts), read for them. `scope` null = everyone; a manager passes
 * his reports. Every read is tenant-filtered (service role, no RLS predicate).
 */
export async function loadTeamSetup(input: { tenantId: string; features: readonly string[]; seats: number | null | undefined; solo: boolean; scope: readonly string[] | null; agencyName: string }): Promise<TeamSetupRow[]> {
  const { tenantId, features, seats, solo, scope } = input;
  const [members, guides, access, agencyProgress, profile] = await Promise.all([
    db().from("tenant_users").select("user_id, role, accepted_at, users!tenant_users_user_id_fkey(name, email, status)").eq("tenant_id", tenantId).limit(500),
    db().from("tenant_setup_guide").select("user_id, skipped_steps, done_steps, finished_at").eq("tenant_id", tenantId).limit(1000),
    db().from("tenant_users").select("user_id, hidden_pages").eq("tenant_id", tenantId).limit(500),
    loadSetupProgress(tenantId),
    loadSetupProfile(tenantId),
  ]);
  if (members.error) throw new Error(`Could not load your team: ${members.error.message}`);

  const guideBy = new Map<string, { skipped_steps: string[] | null; done_steps: string[] | null; finished_at: string | null }>(
    ((guides.error ? [] : guides.data) ?? []).map((row: { user_id: string }) => [row.user_id, row]),
  );
  const hiddenBy = new Map<string, string[]>(((access.error ? [] : access.data) ?? []).map((row: { user_id: string; hidden_pages: string[] | null }) => [row.user_id, row.hidden_pages ?? []]));

  const agency = setupChecklistForState("", agencyProgress, { features, profile, seats, solo });
  const rows: TeamSetupRow[] = [summary({ userId: null, name: `${input.agencyName} · agency setup`, email: null, role: "owner", invited: false }, agency)];

  type Member = { user_id: string; role: string; accepted_at: string | null; users: { name: string | null; email: string | null; status: string | null } | null };
  const people = ((members.data ?? []) as Member[])
    .filter((row) => row.role !== "owner" && row.users?.status !== "deactivated")
    .filter((row) => scope === null || scope.includes(row.user_id));

  const computed = await Promise.all(people.map(async (row) => {
    const guide = guideBy.get(row.user_id);
    const finished = guide?.finished_at != null;
    const progress = row.accepted_at ? await loadMemberSetupProgress(tenantId, row.user_id) : {};
    const checklist = setupChecklistForState("", { ...progress, finished }, {
      features, audience: "member", roles: [row.role], hiddenPages: hiddenBy.get(row.user_id) ?? [],
      marks: { skipped: guide?.skipped_steps ?? [], done: guide?.done_steps ?? [] },
    });
    return summary({ userId: row.user_id, name: row.users?.name || row.users?.email || "Unnamed", email: row.users?.email ?? null, role: row.role, invited: !row.accepted_at }, checklist);
  }));
  // Least done first: the people who need a nudge lead.
  computed.sort((a, b) => Number(a.finished) - Number(b.finished) || a.done / Math.max(a.total, 1) - b.done / Math.max(b.total, 1) || a.name.localeCompare(b.name));
  return [...rows, ...computed];
}

function summary(base: Pick<TeamSetupRow, "userId" | "name" | "email" | "role" | "invited">, checklist: SetupChecklist): TeamSetupRow {
  const next = nextSetupStep(checklist);
  return { ...base, done: checklist.completed, total: checklist.total, next: next?.label ?? null, finished: checklist.total === 0 || checklist.complete };
}
