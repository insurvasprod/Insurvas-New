import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The two facts the first-login gate needs (lib/signup/profileGate.ts): did this agency come through
 * self-serve sign-up, and has it saved a business profile. Two single-row lookups by tenant, read in
 * the shell's parallel batch. Memoised for the request.
 *
 * On a read error it answers "not gated" (hasProfile: true): a database hiccup must not lock an owner
 * out of their workspace.
 */
export const readProfileGateFacts = cache(async (tenantId: string): Promise<{ signedUpHere: boolean; hasProfile: boolean }> => {
  const supabase = getSupabaseServiceClient();
  const [selection, profile] = await Promise.all([
    supabase.from("signup_selections").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("business_profiles").select("tenant_id").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (selection.error || profile.error) return { signedUpHere: false, hasProfile: true };
  return { signedUpHere: Boolean(selection.data), hasProfile: Boolean(profile.data) };
});
