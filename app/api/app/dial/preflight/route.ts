import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { DNC_BLOCK_MESSAGE } from "@/lib/compliance/constants";
import { performDncDialPreflight } from "@/lib/compliance/service";
import { normalizeDialPhone } from "@/lib/compliance/scrub";

/**
 * This is the mandatory compliance boundary immediately before a telephony provider is called.
 * The current repository has no PSTN adapter, so this endpoint intentionally returns a cleared
 * preflight result rather than pretending to place a call. Any future dialer must call this route
 * or the same server service before handing the number to its provider.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null) as { phone?: unknown } | null;
  if (typeof body?.phone !== "string") {
    return NextResponse.json({ error: "Enter a valid phone number", field: "phone" }, { status: 400 });
  }
  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeDialPhone(body.phone);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid phone number", field: "phone" }, { status: 400 });
  }
  try {
    const result = await performDncDialPreflight(normalizedPhone, auth.context.tenantId);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "This number is on a DNC list. Dialing is blocked.", code: "dnc_listed", phone: result.phone },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, code: "dnc_cleared", phone: result.phone, message: "DNC check passed. The number is ready for your connected dialer." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DNC scrub failed";
    if (message === DNC_BLOCK_MESSAGE || message.includes("No fallback vendor is available")) {
      return NextResponse.json({ error: DNC_BLOCK_MESSAGE, code: "dnc_unavailable", blocked: true }, { status: 503 });
    }
    return NextResponse.json({ error: "DNC vendors could not verify this number. Dialing remains blocked until a vendor responds.", code: "dnc_unverified", blocked: true }, { status: 503 });
  }
}
