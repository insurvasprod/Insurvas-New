import { authenticateExtension, extensionFailure, extensionJson, preflight } from "@/lib/extension/grants";
import { readBulk } from "@/lib/extension/fields";

/**
 * LA-3.12 / 3.14 · the extension's bulk read. Bearer grant, no session cookie. The request's Origin
 * must be the grant's carrier origin, and CORS answers that origin only. Never contains the SSN or a
 * bank / card number — those are /fields/[key], one per request.
 * `?application_id=` (optional) is checked against the grant.
 */
export async function GET(request: Request) {
  try {
    const applicationId = new URL(request.url).searchParams.get("application_id");
    const ctx = await authenticateExtension(request, { applicationId });
    return extensionJson(ctx, await readBulk(ctx));
  } catch (error) {
    return extensionFailure(error);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
