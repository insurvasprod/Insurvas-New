import { NextResponse, type NextRequest } from "next/server";

import { bearerKey, handleLeadPost } from "@/lib/leadPost/postHandler";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/post/<workspace> with `Authorization: Bearer <key>` — one URL per workspace.
 *
 * The URL Settings → Lead posting shows. The key still identifies the vendor and the campaign; the
 * path pins the workspace, so a key can only post into the workspace that issued it. Everything
 * after that — rate limit, field map, validation, scrub, log — is `handleLeadPost`, identical to
 * the older /api/leads/post and /api/leads/post/<key>, which stay for vendors already set up on them.
 *
 * Public by design, like those: the key is the authentication.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await context.params;
  if (!UUID.test(workspace)) {
    // The same answer a bad key gets: an unknown workspace is not worth distinguishing.
    return NextResponse.json(
      { accepted: false, reason_code: "unauthorised", message: "That posting URL is not valid. Use the URL shown in your agency's Lead posting settings.", lead_id: null },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }
  return handleLeadPost(request, bearerKey(request), { workspaceId: workspace.toLowerCase() });
}
