import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VOID_INVOICES } from "@/lib/invoices/permissions";
import { setBillingMode } from "@/lib/tenants/billingMode";
import { audit } from "@/lib/audit/log";

const schema = z.object({ mode: z.enum(["automatic", "manual"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VOID_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mode" }, { status: 400 });

  try {
    const result = await setBillingMode(id, parsed.data.mode);

    await audit({
      actorId: auth.session.sub,
      action: "tenant.billing_mode_changed",
      targetType: "tenant",
      targetId: id,
      metadata: { mode: parsed.data.mode, providerWarning: result.warning },
      request,
    });

    return NextResponse.json(result);
  } catch (error) {
    // The provider refused, so our flag was NOT changed — a tenant marked manual while Whop keeps
    // charging would be billed twice.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change billing mode" },
      { status: 502 },
    );
  }
}
