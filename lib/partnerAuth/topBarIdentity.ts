import "server-only";
import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Who the partner top bar says you are: the signed-in partner user, not their organisation.
 *
 * Kept apart from `resolvePartnerContext`, which answers "may this request proceed" and is read on
 * every partner route. This is display copy for one component, so it is its own read, memoised per
 * request and keyed by the plain user id so the layout can start it alongside the context read.
 */
export const readPartnerTopBarIdentity = cache(async (userId: string) => {
  const { data: user } = await getSupabaseServiceClient()
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle<{ name: string | null; email: string | null }>();
  return {
    // A blank name is possible on an invited account; the email is the next best thing a person
    // recognises as themselves.
    name: user?.name?.trim() || user?.email?.split("@")[0] || "Your account",
    email: user?.email ?? "",
  };
});
