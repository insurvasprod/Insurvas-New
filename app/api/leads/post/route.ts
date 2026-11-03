import { type NextRequest } from "next/server";

import { bearerKey, handleLeadPost } from "@/lib/leadPost/postHandler";

/**
 * POST /api/leads/post with `Authorization: Bearer <key>` — the header form of a vendor post.
 *
 * Identical to /api/leads/post/:key in every respect but where the key travels; see
 * `handleLeadPost`. Public for the same reason: the key is the authentication.
 */
export async function POST(request: NextRequest) {
  return handleLeadPost(request, bearerKey(request));
}
