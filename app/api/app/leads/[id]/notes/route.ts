import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { createLeadNote, deleteLeadNote, listLeadNotes, listTeammates, updateLeadNote } from "@/lib/leadNotes/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const roles = ["owner", "producer", "assistant"] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const leadId = (await params).id;
    const [notes, teammates] = await Promise.all([listLeadNotes(auth.context.tenantId, leadId), listTeammates(auth.context.tenantId)]);
    return NextResponse.json({ notes, teammates: teammates.map((user) => ({ id: user.id, name: user.name, role: user.role })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lead notes";
    return NextResponse.json({ error: message }, { status: message === "Lead not found" ? 404 : 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { body?: unknown; visibility?: unknown; mentions?: unknown; idempotency_key?: unknown } | null;
  try {
    const result = await createLeadNote({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, leadId: (await params).id, body: body?.body, visibility: body?.visibility, mentions: body?.mentions, idempotencyKey: body?.idempotency_key });
    if (!result.duplicate) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_note_created", targetType: "lead_note", targetId: result.note.id, metadata: { leadId: (await params).id, visibility: result.note.visibility, mentions: result.note.mentions.length }, request });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save note" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { note_id?: unknown; body?: unknown; visibility?: unknown; mentions?: unknown } | null;
  if (typeof body?.note_id !== "string") return NextResponse.json({ error: "Choose a note to edit" }, { status: 400 });
  try {
    const leadId = (await params).id;
    const note = await updateLeadNote({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, leadId, noteId: body.note_id, body: body.body, visibility: body.visibility, mentions: body.mentions });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_note_updated", targetType: "lead_note", targetId: note.id, metadata: { leadId: (await params).id, visibility: note.visibility }, request });
    return NextResponse.json({ note });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update note" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { note_id?: unknown } | null;
  if (typeof body?.note_id !== "string") return NextResponse.json({ error: "Choose a note to delete" }, { status: 400 });
  try {
    const leadId = (await params).id;
    const note = await deleteLeadNote({ tenantId: auth.context.tenantId, userId: auth.context.userId, leadId, noteId: body.note_id });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_note_deleted", targetType: "lead_note", targetId: note.id, metadata: { leadId: (await params).id, tombstone: true }, request });
    return NextResponse.json({ note });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete note" }, { status: 400 }); }
}
