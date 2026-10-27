import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_FLOW_COOKIE, googleFlowCookieOptions, googleSignInEnabled, startGoogleSignIn, type GoogleFlow } from "@/lib/tenantAuth/google";

/**
 * "Continue with Google" (2026-10-27): starts the Google flow and sends the browser to Google's
 * account chooser. The PKCE verifier stays here, in an httpOnly cookie only the callback reads.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const intent = params.get("intent") === "sign-up" ? "sign-up" : "sign-in";
  const door = new URL(intent === "sign-up" ? "/signup" : "/app/login", request.url);

  if (!(await googleSignInEnabled())) {
    door.searchParams.set("google", "unavailable");
    return NextResponse.redirect(door);
  }

  const started = await startGoogleSignIn();
  if (!started) {
    door.searchParams.set("google", "failed");
    return NextResponse.redirect(door);
  }

  // The plan picked on the pricing page, so a Google sign-up starts from it like the email form does.
  const code = (value: string | null) => (value && /^[a-z][a-z0-9_]{0,40}$/.test(value) ? value : null);
  const flow: GoogleFlow = { verifier: started.verifier, intent, plan: code(params.get("plan")), cycle: code(params.get("cycle")) };
  const response = NextResponse.redirect(started.url);
  response.cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify(flow), googleFlowCookieOptions);
  return response;
}
