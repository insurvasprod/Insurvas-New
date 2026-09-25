import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { TENANT_ROLE_LABELS } from "@/lib/tenantAuth/roles";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";
import { cleanLicenceNumbers, licenceNumbersFromRow, type OwnProfile, type OwnProfileInput } from "./ownProfile";

// The producer-profile table arrives with 20260924200000 and is not in the generated types yet;
// access stays untyped here and nowhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type DbError = { code?: string; message?: string } | null | undefined;

/** A table that is not there yet: Postgres says 42P01, PostgREST PGRST205 (or PGRST204 for a column). */
function isMissingRelation(error: DbError) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204" || /does not exist|schema cache/i.test(error.message ?? "");
}

export class OwnProfileError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Everything the profile page shows about the signed-in person, read by the session's own ids.
 * The two newer sources degrade on their own: licensed states and licence numbers each report
 * "not available yet" instead of failing the page, so name and phone always load.
 */
export async function readOwnProfile(context: TenantContext): Promise<OwnProfile> {
  const [user, tenant, states, producer] = await Promise.all([
    db().from("users").select("name, email, phone").eq("id", context.userId).maybeSingle(),
    db().from("tenants").select("name").eq("id", context.tenantId).maybeSingle(),
    db().from("tenant_user_licensed_states").select("state").eq("tenant_id", context.tenantId).eq("user_id", context.userId).order("state"),
    db().from("tenant_user_producer_profiles").select("npn, state_licence_numbers").eq("tenant_id", context.tenantId).eq("user_id", context.userId).maybeSingle(),
  ]);
  if (user.error || !user.data) throw new OwnProfileError("Your profile could not be loaded.", 503);
  if (states.error && !isMissingRelation(states.error)) throw new OwnProfileError("Your licensed states could not be loaded.", 503);
  if (producer.error && !isMissingRelation(producer.error)) throw new OwnProfileError("Your licence numbers could not be loaded.", 503);

  const row = user.data as { name: string | null; email: string | null; phone: string | null };
  return {
    name: row.name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? null,
    roleLabel: TENANT_ROLE_LABELS[context.role],
    workspaceName: (tenant.data as { name?: string | null } | null)?.name?.trim() || "Your workspace",
    licensedStates: states.error ? null : ((states.data ?? []) as { state: string }[]).map((entry) => entry.state),
    npn: producer.error ? null : (producer.data as { npn?: string | null } | null)?.npn ?? null,
    licenceNumbers: producer.error ? {} : licenceNumbersFromRow((producer.data as { state_licence_numbers?: unknown } | null)?.state_licence_numbers),
    licenceNumbersReady: !producer.error,
  };
}

/**
 * Saves the person's own name and phone, and — when the producer table exists — their NPN and
 * licence numbers. Name and phone are written first and on their own, so a pending migration never
 * stops somebody correcting their phone number; the numbers then fail with a clear 503.
 */
export async function saveOwnProfile(context: TenantContext, input: OwnProfileInput): Promise<OwnProfile> {
  const wantsNumbers = input.npn !== undefined || input.licenceNumbers !== undefined;

  let cleanedNumbers: Record<string, string> | null = null;
  if (wantsNumbers) {
    const states = await db().from("tenant_user_licensed_states").select("state").eq("tenant_id", context.tenantId).eq("user_id", context.userId);
    if (states.error && !isMissingRelation(states.error)) throw new OwnProfileError("Your licensed states could not be checked, so nothing was saved.", 503);
    const licensed = states.error ? [] : ((states.data ?? []) as { state: string }[]).map((entry) => entry.state);
    const cleaned = cleanLicenceNumbers(input.licenceNumbers, licensed);
    if (!cleaned.ok) throw new OwnProfileError(cleaned.error, 400);
    cleanedNumbers = cleaned.value;
  }

  const updated = await db().from("users").update({ name: input.name, phone: input.phone ?? null }).eq("id", context.userId).select("id").maybeSingle();
  if (updated.error || !updated.data) throw new OwnProfileError("Your name and phone could not be saved.", 503);

  if (wantsNumbers) {
    const write = await db().from("tenant_user_producer_profiles").upsert({
      tenant_id: context.tenantId,
      user_id: context.userId,
      npn: input.npn ?? null,
      state_licence_numbers: cleanedNumbers ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,user_id" });
    if (write.error) {
      if (isMissingRelation(write.error)) {
        throw new OwnProfileError("Your name and phone were saved. Licence numbers cannot be stored until the database update for personal licence numbers is applied.", 503);
      }
      throw new OwnProfileError("Your name and phone were saved, but your licence numbers could not be.", 503);
    }
  }
  return readOwnProfile(context);
}
