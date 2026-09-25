import { NextResponse } from "next/server";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ userId: auth.context.userId, partnerId: auth.context.partnerId, partnerName: auth.context.partnerName, role: auth.context.role });
}
