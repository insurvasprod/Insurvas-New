import { isUuid } from "@/lib/applications/http";
import { authenticateExtension, extensionFailure, extensionJson, preflight } from "@/lib/extension/grants";
import { readSensitive } from "@/lib/extension/fields";

/**
 * LA-3.12 · ONE sensitive value (insured.ssn, pay.routing_number, pay.account_number,
 * pay.card_number). The access log row (action 'extension_read', surface 'extension') and the audit
 * row are written before the value is returned. `?entry=<map entry id>` returns it transformed the
 * way that entry of the approved map says. Never cached.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const fieldKey = decodeURIComponent(key);
    const query = new URL(request.url).searchParams;
    const entry = query.get("entry");
    const ctx = await authenticateExtension(request, { applicationId: query.get("application_id"), fieldKey: /^[a-z]+\.[a-z0-9_]+$/.test(fieldKey) ? fieldKey : null });
    return extensionJson(ctx, await readSensitive(ctx, fieldKey, entry && isUuid(entry) ? entry : null));
  } catch (error) {
    return extensionFailure(error);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
