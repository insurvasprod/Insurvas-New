import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PAYMENT_PROVIDERS } from "@/lib/payments/permissions";
import { assignProviderSchema, simulateSchema } from "@/lib/payments/schemas";
import { ensureProviderCustomer, fetchTenantProviderRecord } from "@/lib/payments/registry";
import { isDummyProvider } from "@/lib/payments/constants";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

/** Assign (or change) the provider that charges this tenant. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PAYMENT_PROVIDERS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = assignProviderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();

  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const { data: setting } = await supabase
    .from("provider_settings")
    .select("provider, is_enabled")
    .eq("provider", parsed.data.provider)
    .maybeSingle<{ provider: string; is_enabled: boolean }>();

  if (!setting) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (!setting.is_enabled) {
    return NextResponse.json({ error: "That provider is disabled platform-wide" }, { status: 409 });
  }

  // One default per tenant is enforced by a unique index, so the old default has to be stood down
  // before the new one is raised — not after.
  await supabase.from("payment_providers").update({ is_default: false }).eq("tenant_id", id);

  const { error: upsertError } = await supabase.from("payment_providers").upsert(
    {
      tenant_id: id,
      provider: parsed.data.provider,
      payment_method_label: parsed.data.payment_method_label ?? null,
      is_default: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );

  if (upsertError) {
    return NextResponse.json({ error: "Could not set the payment provider" }, { status: 500 });
  }

  const { data: owner } = await supabase
    .from("tenant_users")
    .select("users(email)")
    .eq("tenant_id", id)
    .eq("role", "owner")
    .maybeSingle<{ users: { email: string } | null }>();

  // Exercises the adapter for real: creates the customer at the provider and logs the call.
  let providerCustomerId: string | null = null;
  try {
    providerCustomerId = await ensureProviderCustomer(id, tenant.name, owner?.users?.email ?? null);
  } catch (error) {
    // The assignment itself stands; only the customer lookup failed, and it retries on next use.
    console.error(`[payment-provider] createCustomer failed for tenant ${id}:`, error);
  }

  await audit({
    actorId: auth.session.sub,
    action: "payment_provider.assigned",
    targetType: "tenant",
    targetId: id,
    metadata: { provider: parsed.data.provider, providerCustomerId },
    request,
  });

  return NextResponse.json({ provider: parsed.data.provider, providerCustomerId });
}

/** Arm or clear the dummy failure simulator for this tenant. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PAYMENT_PROVIDERS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = simulateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }

  const record = await fetchTenantProviderRecord(id);
  if (!record) {
    return NextResponse.json({ error: "Assign a payment provider first" }, { status: 409 });
  }

  if (!isDummyProvider(record.provider)) {
    return NextResponse.json(
      { error: "The failure simulator only applies to dummy providers, never to a live one" },
      { status: 409 },
    );
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("payment_providers")
    .update({ simulate_outcome: parsed.data.simulate_outcome, updated_at: new Date().toISOString() })
    .eq("id", record.id);

  if (error) return NextResponse.json({ error: "Could not update the simulator" }, { status: 500 });

  await audit({
    actorId: auth.session.sub,
    action: "payment_provider.simulator_set",
    targetType: "tenant",
    targetId: id,
    metadata: { provider: record.provider, outcome: parsed.data.simulate_outcome },
    request,
  });

  return NextResponse.json({ simulate_outcome: parsed.data.simulate_outcome });
}
