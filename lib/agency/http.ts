import "server-only";
import { NextResponse } from "next/server";

import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

/** Agency routes · shared request helpers. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to the current calendar month. */
export function periodOf(url: URL): { from: string; to: string } | NextResponse {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? first;
  const to = url.searchParams.get("to") ?? last;
  if (!ISO.test(from) || !ISO.test(to) || to < from) return NextResponse.json({ error: "Choose a period with a start and an end date." }, { status: 400 });
  return { from, to };
}

/** The agency dashboard is the owner's, an admin's and the bookkeeper's — and a manager's, scoped. Never a producer's. */
export function refuseProducerWithoutTitle(context: TenantContext, feature: string): NextResponse | null {
  if (context.role === "producer" && context.memberRole !== "manager") {
    return NextResponse.json({ error: `${feature} is for the owner, admins, managers and the bookkeeper.`, code: "role_not_allowed" }, { status: 403 });
  }
  return null;
}

/** A producer's money is his own and the agency's: a manager sees his reports' production, not their pay. */
export function refuseManagerMoney(context: TenantContext, producerUserId: string): NextResponse | null {
  if (context.memberRole === "manager" && producerUserId !== context.userId) {
    return NextResponse.json({ error: "A manager sees his reports' production, not their pay.", code: "role_not_allowed" }, { status: 403 });
  }
  if (context.role === "assistant") return NextResponse.json({ error: "Assistants see no money figures.", code: "role_not_allowed" }, { status: 403 });
  return null;
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
