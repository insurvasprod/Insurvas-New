import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { acceptPostedLead } from "./service";

/**
 * The HTTP half of a vendor post, shared by both ways a vendor can present its key:
 *
 *   POST /api/leads/post/<key>                                  the key in the path (the original form)
 *   POST /api/leads/post     Authorization: Bearer <key>        the key in a header
 *   POST /api/post/<workspace> Authorization: Bearer <key>      one URL per workspace (the one the
 *                                                               settings screen shows); the key must
 *                                                               belong to that workspace
 *
 * Both reach `acceptPostedLead` with the same key string, so authentication, rate limiting, the
 * field map, the scrub and the log are identical whichever form a vendor's system can send. The
 * header form exists because a URL is logged by every proxy it passes through and a header is not.
 */
export async function handleLeadPost(request: NextRequest, key: string | null, options: { workspaceId?: string } = {}) {
  if (!key) {
    // Same answer an invalid key gets, and deliberately so.
    return NextResponse.json(
      {
        accepted: false,
        reason_code: "unauthorised",
        // The per-workspace URL takes the key in the header only.
        message: options.workspaceId ? "Send your posting key as Authorization: Bearer <key>." : "Send your posting key as Authorization: Bearer <key>, or in the URL path.",
        lead_id: null,
      },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { accepted: false, reason_code: "missing_required_field", message: "The body must be a JSON object." },
      { status: 400 },
    );
  }

  // The vendor's own retry identifier. Taken from a header rather than the body so it survives a
  // payload that differs by a whitespace character between attempts.
  const idempotencyKey = request.headers.get("idempotency-key")?.slice(0, 200) ?? null;

  const outcome = await acceptPostedLead({
    key,
    payload: payload as Record<string, unknown>,
    idempotencyKey,
    workspaceId: options.workspaceId ?? null,
  });

  const headers: Record<string, string> = {};
  if (outcome.retryAfterSeconds) headers["retry-after"] = String(outcome.retryAfterSeconds);

  return NextResponse.json(
    {
      accepted: outcome.outcome === "accepted",
      reason_code: outcome.reasonCode,
      message: outcome.message,
      // Returned on a duplicate as well as an acceptance: a vendor that reposted needs to know
      // which lead it already is, not merely that it exists.
      lead_id: outcome.leadId,
    },
    { status: outcome.status, headers },
  );
}

/** `Authorization: Bearer <key>`, case-insensitive on the scheme; anything else is no key. */
export function bearerKey(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S{1,200})\s*$/i.exec(header);
  return match ? match[1] : null;
}
