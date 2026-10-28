import { NextResponse, type NextRequest } from "next/server";

import { resolveSignupContext } from "@/lib/signup/context";
import { signupDestination } from "@/lib/signup/destination";
import { PROFILE_SKIPPED_COOKIE, profileSkippedCookieOptions } from "@/lib/signup/profileSkip";

/**
 * "Skip for now" on About you: into the app without the business profile, for this visit only
 * (lib/signup/profileSkip.ts). Only once the plan has started: before payment there is no app to
 * skip into, so the owner goes back to where sign-up stands.
 */
export async function GET(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.redirect(new URL("/app/login", request.url));
  if (context.userStatus !== "active" || context.onboardingState !== "completed") {
    return NextResponse.redirect(new URL(signupDestination(context) ?? "/app/dashboard", request.url));
  }
  const response = NextResponse.redirect(new URL("/app/dashboard", request.url));
  response.cookies.set(PROFILE_SKIPPED_COOKIE, "1", profileSkippedCookieOptions);
  return response;
}
