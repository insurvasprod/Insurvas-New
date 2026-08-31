import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_CONFIGURE_PROVIDER } from "@/lib/payments/permissions";
import { getProviderStatus } from "@/lib/payments/status";

/**
 * Returns the safe, read-only provider status used by the Configuration Center and its future
 * provider section. Secrets stay in the process environment and are never part of this response.
 */
export async function GET() {
  const auth = await requireAdminRole(CAN_CONFIGURE_PROVIDER);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(await getProviderStatus());
}
