import { type NextRequest } from "next/server";

import { POST as webLogin } from "../../login/route";
import { partnerAppResponseFrom } from "@/lib/partnerAuth/appSession";
import { requestWithCookies } from "@/lib/tenantAuth/appSession";

/**
 * The phone app's partner sign-in (2026-11-25). Same body as the portal's (email + password) and the
 * portal's own route decides everything: the password, the sign-in rate limit, an active membership
 * of a partner that is not offboarded, an agency account refused (plane separation), a suspended
 * agency, the agency's partner feature, maintenance. Any cookie the caller sent is dropped before the
 * portal route runs, so nothing but the email and password counts.
 *
 * Answers: { ok, access, refresh, expiresAt } signed in · the portal's error otherwise (same status).
 * The tokens are partner tokens: signed with the partner key and marked cli "app", so no tenant
 * route can read them (requireTenant verifies with the tenant key) and the partner plane reads them
 * only from an `Authorization: Bearer` header (lib/partnerAuth/requirePartner.ts).
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  return partnerAppResponseFrom(await webLogin(requestWithCookies(request, {}, body)));
}
