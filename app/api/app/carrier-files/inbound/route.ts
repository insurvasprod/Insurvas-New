import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import {
  CarrierFileError,
  addSender,
  createInboundAddress,
  getInboundAddress,
  listSenders,
  removeSender,
} from "@/lib/ingestion/registry";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.1 (Notion sprint) · the email door's settings: the agency's own inbound address and the
 * carriers' known senders.
 *
 *   GET     the address (null until made) and the senders. Reading only — opening the page never
 *           creates an address.
 *   POST    { action: "create_address" } gives the agency its address, once.
 *           { action: "add_sender", carrier_id, sender } — an exact address or "@domain".
 *   DELETE  ?sender_id=… removes one of the agency's own senders.
 *
 * Owner and bookkeeper. Every change is a write and is audited.
 */
const roles = ["owner", "bookkeeper"] as const;

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_address") }).strict(),
  z.object({ action: z.literal("add_sender"), carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."), sender: z.string().min(3).max(254) }).strict(),
]);

function failure(error: unknown, fallback: string) {
  if (error instanceof CarrierFileError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[carrier-files/inbound] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const [address, senders] = await Promise.all([getInboundAddress(auth.context.tenantId), listSenders(auth.context.tenantId)]);
    return NextResponse.json({ ok: true, ...address, senders: senders.senders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "Could not load the email settings");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = postSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    if (body.data.action === "create_address") {
      const address = await createInboundAddress(tenantId, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_inbound_address_created", targetType: "tenant", targetId: tenantId, metadata: { tenantId }, request });
      return NextResponse.json({ ok: true, ...address }, { status: 201 });
    }
    const sender = await addSender(tenantId, userId, body.data.carrier_id, body.data.sender);
    await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_inbound_sender_added", targetType: "carrier", targetId: sender.carrierId, metadata: { tenantId, sender: sender.sender }, request });
    return NextResponse.json({ ok: true, sender }, { status: 201 });
  } catch (error) {
    return failure(error, "The change could not be saved");
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const senderId = request.nextUrl.searchParams.get("sender_id") ?? "";
  if (!isRecordUuid(senderId)) return NextResponse.json({ error: "Choose the sender to remove." }, { status: 400 });
  try {
    await removeSender(auth.context.tenantId, senderId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_inbound_sender_removed", targetType: "carrier_inbound_sender", targetId: senderId, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error, "The sender could not be removed");
  }
}
