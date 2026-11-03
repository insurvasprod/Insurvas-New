import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { invoiceFail } from "@/lib/accounting/invoiceSchemas";
import { attachDocument, documentUrl } from "@/lib/accounting/invoiceStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.2 (Notion sprint) · the invoice document: attach it (PDF or image, tenant-scoped storage) and
 * open it through a 60-second signed link. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.redirect(await documentUrl(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invoiceFail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await attachDocument(tenantId, id, file);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.invoice_saved", targetType: "vendor_invoice", targetId: id, metadata: { tenantId, document: true }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return invoiceFail(error);
  }
}
