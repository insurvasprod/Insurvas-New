import { NextResponse } from "next/server";
import { PARTNER_SESSION_COOKIE } from "@/lib/partnerAuth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(PARTNER_SESSION_COOKIE);
  return response;
}
