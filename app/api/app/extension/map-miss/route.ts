import { authenticateExtension, corsHeaders, extensionFailure, extensionJson, preflight } from "@/lib/extension/grants";
import { recordMapMiss } from "@/lib/extension/maps";
import { mapMissSchema } from "@/lib/extension/schemas";

/**
 * LA-3.13 · a fill found mapped fields missing on the carrier's page. Records `map_miss` events (and
 * the page's fill rate), and flags a published map `needs_review`. Bearer grant.
 */
export async function POST(request: Request) {
  try {
    const ctx = await authenticateExtension(request);
    const parsed = mapMissSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Check the details and try again.", code: "invalid_request" }, { status: 400, headers: corsHeaders(ctx.origin) });
    const input = parsed.data;
    const result = await recordMapMiss(ctx, { mapId: input.map_id, pageKey: input.page_key, url: input.url, misses: input.misses, filled: input.fields_filled, total: input.fields_total });
    return extensionJson(ctx, result);
  } catch (error) {
    return extensionFailure(error);
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
