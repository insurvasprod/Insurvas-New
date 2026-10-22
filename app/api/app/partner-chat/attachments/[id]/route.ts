import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAttachmentForUser } from "@/lib/partnerChat/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

const roles = ["owner", "producer"] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  try {
    // AG-0.5: an attachment on a card about another producer's transfer is "not found" in an agency.
    const url = await getAttachmentForUser(auth.context.tenantId, id, auth.context.userId, null, await scopeFor(auth.context));
    return NextResponse.redirect(url);
  } catch { return NextResponse.json({ error: "Attachment not found" }, { status: 404 }); }
}
