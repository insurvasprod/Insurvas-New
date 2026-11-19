import "server-only";

import { cache } from "react";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { dailyChecksFor, type DailyCheck, type DailyCheckInput } from "./dailyChecks";
import { fetchDailyCheckInput } from "./dailyQueries";

/**
 * The daily checks' inputs, read once a request (React's per-request `cache`): the status line under the
 * title, Needs you and Platform health all ask for them on the same render, and the platform reads behind
 * them are the slowest on the page. Keyed on the id and role strings, not an object, so every caller hits
 * the same entry. Never throws: each input settles on its own (dailyQueries.ts).
 */
export const dailyInputFor = cache((adminId: string, role: AdminRole): Promise<DailyCheckInput> => fetchDailyCheckInput({ id: adminId, role }));

/** The role's checks, worst first, from the shared input. */
export async function dailyChecksForAdmin(admin: { id: string; role: AdminRole }): Promise<{ input: DailyCheckInput; checks: DailyCheck[] }> {
  const input = await dailyInputFor(admin.id, admin.role);
  return { input, checks: dailyChecksFor(admin.role, input) };
}
