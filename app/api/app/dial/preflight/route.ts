import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { DNC_BLOCK_MESSAGE } from "@/lib/compliance/constants";
import { runDialPreflightChecks } from "@/lib/compliance/dialPreflight";
import { normalizeDialPhone } from "@/lib/compliance/scrub";

/**
 * This is the mandatory compliance boundary immediately before a telephony provider is called.
 * The current repository has no PSTN adapter, so this endpoint intentionally returns a cleared
 * preflight result rather than pretending to place a call. Any future dialer must call this route
 * or the same server service before handing the number to its provider.
 *
 * Since the "Check a number before dialing" dialog, every check runs for every request (user
 * decision 2026-09-24) and the answer carries them as `checks`, so the screen shows what was found
 * rather than the first refusal only. The status codes, `code`, `blocked` and `error`/`message`
 * fields are unchanged for every case they covered before (scripts/verify-dial-preflight.mjs pins
 * them); the DNC decision still outranks the checks that were added after it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null) as { phone?: unknown; state?: unknown } | null;
  if (typeof body?.phone !== "string") {
    return NextResponse.json({ error: "Enter a valid phone number", field: "phone" }, { status: 400 });
  }
  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeDialPhone(body.phone);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a valid phone number", field: "phone" }, { status: 400 });
  }
  let state: string | null = null;
  if (body.state !== undefined && body.state !== null && body.state !== "") {
    if (typeof body.state !== "string" || !/^[A-Za-z]{2}$/.test(body.state.trim())) {
      return NextResponse.json({ error: "Choose the customer's state", field: "state" }, { status: 400 });
    }
    state = body.state.trim().toUpperCase();
  }

  let report: Awaited<ReturnType<typeof runDialPreflightChecks>>;
  try {
    report = await runDialPreflightChecks({ tenantId: auth.context.tenantId, userId: auth.context.userId, normalizedPhone, state });
  } catch {
    return NextResponse.json({ error: "DNC vendors could not verify this number. Dialing remains blocked until a vendor responds.", code: "dnc_unverified", blocked: true }, { status: 503 });
  }
  const detail = { phone: report.phone, checks: report.checks, suppression: report.suppression, lead: report.lead, state: report.state };
  const { outcome } = report;

  // The order is the one the endpoint always had: the agency's list, then the DNC vendor.
  if (outcome.suppression === "listed" || outcome.dnc === "listed") {
    return NextResponse.json({ error: "This number is on a DNC list. Dialing is blocked.", code: "dnc_listed", ...detail }, { status: 422 });
  }
  if (outcome.suppression === "unavailable") {
    return NextResponse.json({ error: "DNC vendors could not verify this number. Dialing remains blocked until a vendor responds.", code: "dnc_unverified", blocked: true, ...detail }, { status: 503 });
  }
  if (outcome.dnc === "no_vendor") {
    return NextResponse.json({ error: DNC_BLOCK_MESSAGE, code: "dnc_unavailable", blocked: true, ...detail }, { status: 503 });
  }
  if (outcome.dnc === "unverified") {
    return NextResponse.json({ error: "DNC vendors could not verify this number. Dialing remains blocked until a vendor responds.", code: "dnc_unverified", blocked: true, ...detail }, { status: 503 });
  }
  // The checks added with the dialog. Each refuses on its own; a missing answer is a refusal.
  if (outcome.litigator === "listed") {
    return NextResponse.json({ error: "This number matched a TCPA litigator list. Dialing is blocked.", code: "litigator_listed", ...detail }, { status: 422 });
  }
  if (outcome.litigator === "unavailable") {
    return NextResponse.json({ error: "The litigator check could not be completed. Dialing remains blocked until it answers.", code: "litigator_unavailable", blocked: true, ...detail }, { status: 503 });
  }
  if (outcome.window === "outside") {
    return NextResponse.json({ error: "This number is outside the customer's calling window right now. Dialing is blocked.", code: "outside_window", ...detail }, { status: 422 });
  }
  if (outcome.window === "no_state") {
    return NextResponse.json({ error: "Choose the customer's state so the calling window can be checked.", code: "state_required", ...detail }, { status: 422 });
  }
  if (outcome.window === "unavailable") {
    return NextResponse.json({ error: "The calling-window policy could not be verified. Dialing remains blocked.", code: "window_unavailable", blocked: true, ...detail }, { status: 503 });
  }
  return NextResponse.json({ ok: true, code: "dnc_cleared", message: "DNC check passed. The number is ready for your connected dialer.", ...detail });
}
