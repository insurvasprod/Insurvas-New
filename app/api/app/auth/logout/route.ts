import { NextResponse } from "next/server";

import { TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(TENANT_SESSION_COOKIE);
  return response;
}
