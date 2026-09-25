import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { contactSchema } from "@/lib/contacts/schemas";
import { createContact, getContactDirectory, getContactWorkspace } from "@/lib/contacts/service";

const CONTACT_ROLES = ["owner", "producer", "assistant"] as const;

/**
 * The duplicate-check workspace. `?q=` searches server-side, `?page=` (0-based) and `?pageSize=` page
 * the directory. `?view=directory` returns only the directory, for search and paging.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  const options = { q: params.get("q") ?? "", page: Number(params.get("page") ?? 0) || 0, pageSize: Number(params.get("pageSize") ?? 25) || 25 };
  try {
    if (params.get("view") === "directory") return NextResponse.json({ directory: await getContactDirectory(auth.context.tenantId, options) });
    return NextResponse.json(await getContactWorkspace(auth.context.tenantId, auth.context.userId, options));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load contacts" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("duplicate_detection", CONTACT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = contactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Contact details are invalid" }, { status: 400 });
  try {
    const result = await createContact(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_created", targetType: "contact", targetId: result.contact.id, metadata: { outcome: result.outcome, duplicateCount: result.duplicates.length, queued: result.queued }, request });
    if (result.mergeId) await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.contact_merged", targetType: "merge", targetId: result.mergeId, metadata: { outcome: result.outcome, source: "auto" }, request });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create contact" }, { status: 400 }); }
}
