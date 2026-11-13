import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { audit } from "@/lib/audit/log";
import { deleteWebhook, queueTestEvent } from "@/lib/webhooks/service";
import { FormSchemaPendingError, readFormWebhook, saveFormWebhook } from "@/lib/templates/formsServer";

/**
 * Form settings › When a form is sent (board A8): one signed webhook per form on the LA-8.7 queue,
 * with its recent deliveries. Needs 20261112200000 (the form scope and the form.* events).
 */
const pending = (error: FormSchemaPendingError) => NextResponse.json({ code: "schema_pending", error: error.message, hook: null, deliveries: [] }, { status: 503 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    return NextResponse.json(await readFormWebhook(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pending(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the webhook" }, { status: 400 });
  }
}

/** Save the address and events; the signing secret comes back once, when the webhook is made. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { target_url?: string; events?: string[] } | null;
  if (!body?.target_url) return NextResponse.json({ error: "Enter the address to send to" }, { status: 400 });
  try {
    const { id } = await params;
    const saved = await saveFormWebhook(auth.context.tenantId, auth.context.userId, id, { target_url: body.target_url, events: body.events ?? ["form.submitted"] });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: saved.secret ? "tenant.webhook_created" : "tenant.form_definition_saved", targetType: "webhook_subscription", targetId: saved.hook.id, metadata: { change: "form_webhook", tenant_template_id: id, events: saved.hook.events }, request });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pending(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the webhook" }, { status: 400 });
  }
}

/** Send a test: a signed webhook.test delivery, due now. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { hook } = await readFormWebhook(auth.context.tenantId, id);
    if (!hook) return NextResponse.json({ error: "Save the webhook first" }, { status: 400 });
    return NextResponse.json({ delivery: await queueTestEvent(auth.context.tenantId, hook.id) });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pending(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send a test" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const { hook } = await readFormWebhook(auth.context.tenantId, id);
    if (!hook) return NextResponse.json({ ok: true });
    await deleteWebhook(auth.context.tenantId, hook.id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.webhook_deleted", targetType: "webhook_subscription", targetId: hook.id, metadata: { tenant_template_id: id }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FormSchemaPendingError) return pending(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove the webhook" }, { status: 400 });
  }
}
