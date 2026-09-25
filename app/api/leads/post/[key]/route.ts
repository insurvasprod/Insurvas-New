import { type NextRequest } from "next/server";

import { handleLeadPost } from "@/lib/leadPost/postHandler";

/**
 * LA-2.5 · POST /api/leads/post/:key — a vendor posting a real-time lead.
 *
 * Public by design: the vendor's key IS the authentication, because a lead vendor's posting system
 * cannot hold a session. That is why the key is hashed at rest, rate-limited per key, and carries
 * no other privilege — a stolen key can post leads to one vendor's campaigns and do nothing else.
 *
 * Every answer is machine-readable. "Rejections are the billing mechanism": a vendor reconciling
 * their invoice needs to know that lead 4821 was refused as `suppressed_litigator` rather than
 * merely that something went wrong, and a human-readable string is not a reason code.
 *
 * The same post is accepted at /api/leads/post with `Authorization: Bearer <key>`; both forms run
 * through `handleLeadPost`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  return handleLeadPost(request, key);
}
