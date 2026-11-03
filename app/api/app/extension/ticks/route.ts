import { authenticateExtension, corsHeaders, extensionFailure, extensionJson, preflight } from "@/lib/extension/grants";
import { extensionTickSchema } from "@/lib/extension/schemas";
import { listTicks, putTicks } from "@/lib/extension/ticks";

/** LA-3.14 · copy-assist ticks from the extension's side panel (surface 'extension'). Bearer grant. */
export async function GET(request: Request) {
  try {
    const ctx = await authenticateExtension(request);
    return extensionJson(ctx, { ticks: await listTicks(ctx.tenantId, ctx.application.id) });
  } catch (error) {
    return extensionFailure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await authenticateExtension(request);
    const parsed = extensionTickSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose a valid field", code: "invalid_request" }, { status: 400, headers: corsHeaders(ctx.origin) });
    return extensionJson(ctx, await putTicks(ctx.tenantId, ctx.userId, ctx.application.id, [parsed.data.field_key], "extension"));
  } catch (error) {
    return extensionFailure(error);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
