import "server-only";

import { appointmentIsActiveAt } from "@/lib/appointments/eligibility";
import { getAppointmentVault } from "@/lib/appointments/service";
import type { LooseDb } from "@/lib/supabase/loose";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerRole } from "@/lib/partnerAuth/roles";

export type Market = {
  carrier_id: string;
  carrier_name: string;
  state: string;
};
export type MarketProfileSource =
  "partner_user" | "partner_admin" | "publisher" | "tenant_appointments";
export type ResolvedMarkets = {
  markets: Market[];
  source: MarketProfileSource;
  profile_id: string | null;
  revision: number | null;
};
type MarketProfileRow = {
  id: string;
  current_revision: number;
  scope: MarketProfileSource;
};
type MarketItemRow = { carrier_id: string; state: string };
type PartnerMembershipRow = {
  user_id: string;
  role: PartnerRole;
  partner_admin_user_id: string | null;
};
type SavedMarketProfile = { profile_id: string; revision: number };

const isState = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{2}$/.test(value);

export async function eligibleTenantMarkets(
  tenantId: string,
  asOf = new Date().toISOString().slice(0, 10),
): Promise<Market[]> {
  const vault = await getAppointmentVault(tenantId);
  const carrierNames = new Map(
    vault.carriers.map((carrier) => [carrier.id, carrier.name]),
  );
  const activeCarrierIds = new Set(
    vault.tenantCarriers
      .filter((carrier) => carrier.is_active && carrier.effective_from <= asOf)
      .map((carrier) => carrier.carrier_id),
  );
  const latest = new Map<string, (typeof vault.appointments)[number]>();
  for (const appointment of vault.appointments) {
    if (!activeCarrierIds.has(appointment.carrier_id)) continue;
    const key = `${appointment.carrier_id}:${appointment.state}`;
    const current = latest.get(key);
    if (!current || appointment.effective_from > current.effective_from)
      latest.set(key, appointment);
  }
  return [...latest.entries()]
    .filter(([, appointment]) => appointmentIsActiveAt(appointment, asOf))
    .map(([key]) => {
      const [carrier_id, state] = key.split(":");
      return {
        carrier_id,
        state,
        carrier_name: carrierNames.get(carrier_id) ?? "Carrier",
      };
    })
    .sort(
      (a, b) =>
        a.carrier_name.localeCompare(b.carrier_name) ||
        a.state.localeCompare(b.state),
    );
}

async function profileFor(
  tenantId: string,
  partnerId: string,
  scope: Exclude<MarketProfileSource, "tenant_appointments">,
  subjectUserId: string | null,
) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  let request = db
    .from<MarketProfileRow>("partner_market_access_profiles")
    .select("id, current_revision, scope")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .eq("scope", scope);
  request = subjectUserId
    ? request.eq("subject_user_id", subjectUserId)
    : request.is("subject_user_id", null);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error(`Could not load market access: ${error.message}`);
  return data as {
    id: string;
    current_revision: number;
    scope: MarketProfileSource;
  } | null;
}

async function itemsFor(profileId: string, revision: number) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { data, error } = await db
    .from<MarketItemRow[]>("partner_market_access_revision_items")
    .select("carrier_id, state")
    .eq("profile_id", profileId)
    .eq("revision", revision);
  if (error)
    throw new Error(`Could not load market access items: ${error.message}`);
  return (data ?? []) as Array<{ carrier_id: string; state: string }>;
}

export async function resolvePartnerMarkets(
  tenantId: string,
  partnerId: string,
  userId: string,
): Promise<ResolvedMarkets> {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { data: membership, error } = await db
    .from<PartnerMembershipRow>("partner_users")
    .select("user_id, role, partner_admin_user_id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error(`Could not load partner membership: ${error.message}`);
  if (!membership) throw new Error("partner_membership_not_found");
  const role = membership.role as PartnerRole;
  const candidates: Array<{
    source: Exclude<MarketProfileSource, "tenant_appointments">;
    subject: string | null;
  }> =
    role === "partner_admin"
      ? [
          { source: "partner_admin", subject: userId },
          { source: "publisher", subject: null },
        ]
      : [
          { source: "partner_user", subject: userId },
          ...(membership.partner_admin_user_id
            ? [
                {
                  source: "partner_admin" as const,
                  subject: membership.partner_admin_user_id as string,
                },
              ]
            : []),
          { source: "publisher", subject: null },
        ];
  const eligible = await eligibleTenantMarkets(tenantId);
  const eligibleByKey = new Map(
    eligible.map((market) => [`${market.carrier_id}:${market.state}`, market]),
  );
  for (const candidate of candidates) {
    const profile = await profileFor(
      tenantId,
      partnerId,
      candidate.source,
      candidate.subject,
    );
    if (!profile) continue;
    const items = await itemsFor(profile.id, profile.current_revision);
    return {
      markets: items.flatMap(
        (item) => eligibleByKey.get(`${item.carrier_id}:${item.state}`) ?? [],
      ),
      source: candidate.source,
      profile_id: profile.id,
      revision: profile.current_revision,
    };
  }
  return {
    markets: eligible,
    source: "tenant_appointments",
    profile_id: null,
    revision: null,
  };
}

export async function getOwnerMarketProfile(
  tenantId: string,
  partnerId: string,
  scope: Exclude<MarketProfileSource, "tenant_appointments">,
  subjectUserId: string | null,
  fallbackUserId: string,
) {
  const [profile, effective, eligible] = await Promise.all([
    profileFor(tenantId, partnerId, scope, subjectUserId),
    resolvePartnerMarkets(tenantId, partnerId, fallbackUserId),
    eligibleTenantMarkets(tenantId),
  ]);
  const markets = profile
    ? await itemsFor(profile.id, profile.current_revision)
    : [];
  return {
    profile: profile ? { ...profile, markets } : null,
    effective,
    eligible,
  };
}

export async function saveOwnerMarketProfile(
  tenantId: string,
  partnerId: string,
  scope: Exclude<MarketProfileSource, "tenant_appointments">,
  subjectUserId: string | null,
  markets: Array<{ carrier_id: string; state: string }>,
  createdBy: string,
) {
  if (
    !markets.every(
      (market) =>
        typeof market.carrier_id === "string" && isState(market.state),
    )
  )
    throw new Error("Invalid carrier or state");
  const eligible = new Set(
    (await eligibleTenantMarkets(tenantId)).map(
      (market) => `${market.carrier_id}:${market.state}`,
    ),
  );
  if (
    markets.some(
      (market) => !eligible.has(`${market.carrier_id}:${market.state}`),
    )
  )
    throw new Error(
      "A selected carrier/state pair is not an active agency appointment",
    );
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { data, error } = await db.rpc<SavedMarketProfile | SavedMarketProfile[]>(
    "save_partner_market_access_profile_revision",
    {
      p_tenant_id: tenantId,
      p_partner_id: partnerId,
      p_subject_user_id: subjectUserId,
      p_scope: scope,
      p_markets: markets,
      p_created_by: createdBy,
    },
  );
  if (error) throw new Error(error.message);
  const result = (Array.isArray(data) ? data[0] : data) as SavedMarketProfile | null;
  if (!result?.profile_id) throw new Error("Could not save market access");
  return result as { profile_id: string; revision: number };
}

export async function assertPartnerMarketAccess(
  tenantId: string,
  partnerId: string,
  userId: string,
  carrierId: string,
  state: string,
) {
  if (!isState(state)) throw new Error("invalid_market_state");
  const resolved = await resolvePartnerMarkets(tenantId, partnerId, userId);
  const market = resolved.markets.find(
    (item) => item.carrier_id === carrierId && item.state === state,
  );
  if (!market) throw new Error("partner_market_not_allowed");
  return {
    ...market,
    profile_id: resolved.profile_id,
    revision: resolved.revision,
  };
}
