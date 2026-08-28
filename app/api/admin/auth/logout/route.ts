import { NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE, ADMIN_PENDING_2FA_COOKIE } from "@/lib/adminAuth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_SESSION_COOKIE);
  response.cookies.delete(ADMIN_PENDING_2FA_COOKIE);
  return response;
}
