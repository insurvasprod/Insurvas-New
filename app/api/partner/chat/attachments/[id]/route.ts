import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAttachmentForUser } from "@/lib/partnerChat/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  try {
    const url = await getAttachmentForUser(auth.context.tenantId, id, auth.context.userId, auth.context.partnerId);
    return NextResponse.redirect(url);
  } catch { return NextResponse.json({ error: "Attachment not found" }, { status: 404 }); }
}
