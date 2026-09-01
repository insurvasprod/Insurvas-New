import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { contactSchema } from "@/lib/contacts/schemas";
import { createContact, getContactWorkspace } from "@/lib/contacts/service";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const workspace = await getContactWorkspace(auth.context.tenantId, auth.context.userId);
    const query = request.nextUrl.searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
    if (!query) return NextResponse.json(workspace);
    return NextResponse.json({ ...workspace, contacts: workspace.contacts.filter((contact) => [contact.first_name, contact.last_name, contact.primary_phone, contact.state, contact.city, contact.address_line1, ...contact.emails.map((email) => email.email), ...Object.values(contact.custom_fields).map(String)].some((value) => String(value ?? "").toLocaleLowerCase().includes(query))) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load contacts" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = contactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Contact details are invalid" }, { status: 400 });
  try {
    const result = await createContact(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_created", targetType: "contact", targetId: result.contact.id, metadata: { outcome: result.outcome, duplicateCount: result.duplicates.length }, request });
    if (result.mergeId) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merged", targetType: "merge", targetId: result.mergeId, metadata: { outcome: result.outcome }, request });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create contact" }, { status: 400 }); }
}
