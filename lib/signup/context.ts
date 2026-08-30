import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getTenantSession } from "@/lib/tenantAuth/requireTenant";
import { isTenantRole, type TenantRole } from "@/lib/tenantAuth/roles";

export type SignupContext = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  userStatus: string;
  tenantStatus: string;
  onboardingState: string;
  role: TenantRole;
};

export async function resolveSignupContext(): Promise<SignupContext | null> {
  const session = await getTenantSession();
  if (!session) return null;

  const supabase = getSupabaseServiceClient();
  const [{ data: user }, { data: tenant }, { data: membership }] = await Promise.all([
    supabase.from("users").select("email, name, status").eq("id", session.sub).maybeSingle(),
    supabase.from("tenants").select("status, onboarding_state").eq("id", session.tenantId).maybeSingle(),
    supabase
      .from("tenant_users")
      .select("role")
      .eq("user_id", session.sub)
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
  ]);

  if (!user || !tenant || !membership || !isTenantRole(membership.role)) return null;
  return {
    userId: session.sub,
    tenantId: session.tenantId,
    email: user.email,
    name: user.name,
    userStatus: user.status,
    tenantStatus: tenant.status,
    onboardingState: tenant.onboarding_state,
    role: membership.role,
  };
}

export function signupDestination(context: Pick<SignupContext, "userStatus" | "onboardingState">): string | null {
  if (context.userStatus === "pending_verification") return "/app/verify-email";
  if (context.userStatus !== "active") return null;
  if (context.onboardingState === "business_profile") return "/app/onboarding/business-profile";
  if (context.onboardingState === "ready_for_checkout") return "/app/checkout";
  return null;
}
