import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/**
 * LA-4.7 (Notion sprint) · recompute Layer 3 for a scope through refresh_policy_current — after a
 * file's snapshots (the policies it touched), or after a carrier rule changes (that carrier, for one
 * agency or, with no agency, every agency). The daily job covers the calendar.
 *
 * Returns the rows written, or null while the migration (20261008160000) is not applied — the
 * layers below it keep working without it.
 */
export async function refreshPolicyCurrent(scope: { tenantId: string | null; carrierId: string; policies?: string[] }): Promise<number | null> {
  const call = () => db().rpc("refresh_policy_current", { p_tenant_id: scope.tenantId, p_carrier_id: scope.carrierId, p_policy_numbers: scope.policies ?? null });
  let { data, error } = await call();
  // A statement timeout under load is not a wrong answer: the refresh is one statement (delete, then
  // insert), so a timed-out call changed nothing. Try again after a pause, then in two halves, so a
  // busy moment cannot leave a file's policies out of the book (200 Aetna policies timed out at 8 s
  // on 2026-10-14 while other files were being read; quiet, the same 200 take 1–2 s).
  for (const pause of [2_000, 6_000]) {
    if (!error || !STATEMENT_TIMEOUT.test(error.message ?? "")) break;
    await new Promise((resolve) => setTimeout(resolve, pause));
    ({ data, error } = await call());
  }
  if (error && STATEMENT_TIMEOUT.test(error.message ?? "") && scope.policies && scope.policies.length > MIN_SPLIT) {
    const half = Math.ceil(scope.policies.length / 2);
    const first = await refreshPolicyCurrent({ ...scope, policies: scope.policies.slice(0, half) });
    const second = await refreshPolicyCurrent({ ...scope, policies: scope.policies.slice(half) });
    return first === null || second === null ? null : first + second;
  }
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`The current policy rows could not be refreshed: ${error.message}`);
  }
  return Number(data ?? 0);
}

const STATEMENT_TIMEOUT = /statement timeout|canceling statement/i;
/** Below this many policies a list is not split further: a timeout that small is a real fault. */
const MIN_SPLIT = 25;
