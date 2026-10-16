import { type NextRequest } from "next/server";

import { apiError, apiJson, authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { deleteWebhook } from "@/lib/webhooks/service";

/** LA-8.7 · DELETE /api/v1/webhooks/:id (webhooks:manage). Only the key's own agency's webhooks. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, "DELETE /api/v1/webhooks/:id");
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, "not_found", "No such webhook.");
  try {
    await deleteWebhook(auth.tenantId, id);
    return apiJson({ deleted: true });
  } catch {
    return apiError(404, "not_found", "No such webhook.");
  }
}
