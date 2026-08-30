import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_CONFIGURE_PROVIDER } from "@/lib/payments/permissions";
import { WhopClient, WhopApiError } from "@/lib/payments/whop/client";
import { deriveMode } from "@/lib/payments/statusRules";

/**
 * Proves the platform can reach Whop and that the API key is accepted.
 *
 * It tests REACHABILITY AND AUTHENTICATION, not one endpoint's shape. Whop is asked for a payment
 * id that cannot exist: a 401 or 403 means the key was rejected, and ANY other answer — including
 * the 404 we expect — means we reached Whop and it accepted who we are. Pinning the test to a
 * specific endpoint would turn a Whop API change into a false alarm about our credentials.
 *
 * The call goes through WhopClient, so it lands in provider_calls like every other call and shows
 * up in the health panel that sits above this button.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_CONFIGURE_PROVIDER);
  if (auth instanceof NextResponse) return auth;

  const apiKey = process.env.WHOP_API_KEY;
  const baseUrl = process.env.WHOP_API_BASE_URL;

  if (!apiKey || !baseUrl) {
    const missing = [!apiKey && "WHOP_API_KEY", !baseUrl && "WHOP_API_BASE_URL"].filter(Boolean).join(" and ");
    return NextResponse.json(
      { ok: false, error: `${missing} is not set, so no Whop call can be made.` },
      { status: 200 },
    );
  }

  const client = new WhopClient({ apiKey, baseUrl });
  const startedAt = Date.now();

  let ok: boolean;
  let message: string;

  try {
    await client.request("GET", "/payments/pmt_connection_test_does_not_exist");
    ok = true;
    message = "Whop answered and accepted the API key.";
  } catch (error) {
    if (error instanceof WhopApiError && (error.status === 401 || error.status === 403)) {
      ok = false;
      message = `Whop rejected the API key (HTTP ${error.status}). Check WHOP_API_KEY matches the ${deriveMode(baseUrl)} account.`;
    } else if (error instanceof WhopApiError) {
      // Reached Whop, authenticated, and it said "no such payment" — which is the point.
      ok = true;
      message = `Whop answered and accepted the API key (HTTP ${error.status} for a deliberately invalid id).`;
    } else {
      // Never reached Whop at all: DNS, TLS, a firewall, or a wrong host.
      ok = false;
      message = `Could not reach ${baseUrl} — ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Audited whatever the outcome. Under the SA-4.2 decision the keys are not editable in the app,
  // so this is the only provider-configuration action there is to record — and a run of failing
  // tests is exactly the trail somebody will want during an incident.
  await audit({
    actorId: auth.session.sub,
    action: "payment_provider.connection_tested",
    targetType: "payment_provider",
    targetId: "whop",
    metadata: { ok, mode: deriveMode(baseUrl), durationMs: Date.now() - startedAt },
    request,
  });

  return NextResponse.json({ ok, message });
}
