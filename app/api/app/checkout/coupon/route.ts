import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveSignupContext } from "@/lib/signup/context";
import { checkCoupon } from "@/lib/checkout/start";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const schema = z.object({ code: z.string().trim().min(1).max(40) });

/**
 * Validates a coupon before checkout opens — the ticket's criterion that an invalid code is
 * rejected here rather than after the customer has been sent to a hosted page.
 */
export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a code" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase
    .from("signup_selections")
    .select("plan_id")
    .eq("tenant_id", context.tenantId)
    .maybeSingle<{ plan_id: string }>();

  if (!selection) return NextResponse.json({ error: "No plan selected" }, { status: 409 });

  const result = await checkCoupon(parsed.data.code, selection.plan_id);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  return NextResponse.json({ ok: true, code: result.code });
}
