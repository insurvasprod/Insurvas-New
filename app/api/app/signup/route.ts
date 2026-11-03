import { NextResponse } from "next/server";

/**
 * Retired (2026-10-15). Sign-up is the public flow only: POST /api/public/signup, from /signup.
 *
 * This route called self_serve_signup_with_subscription (migration 0018), which could not work —
 * public.users.id references auth.users, and it created no Auth identity — and which, had it
 * worked, would have skipped email verification, legal acceptance, the disposable-address check
 * and the card Whop takes for the trial, and written an active subscription directly. Migration
 * 20261015580000 drops that function. 410 rather than 404 so a stale client learns where to go.
 */
const GONE = { error: "This sign-up endpoint has been retired. Create your workspace at /signup.", redirectTo: "/signup" } as const;

export function POST() {
  return NextResponse.json(GONE, { status: 410 });
}

export function GET() {
  return NextResponse.json(GONE, { status: 410 });
}
