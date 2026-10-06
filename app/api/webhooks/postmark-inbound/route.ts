import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { checkPostmarkBasicAuth } from "@/lib/ingestion/doorAuth";
import type { PostmarkInbound } from "@/lib/ingestion/inboundEmail";
import { receiveInboundEmail } from "@/lib/ingestion/registry";

export const dynamic = "force-dynamic";

/**
 * LA-4.1 (Notion sprint) · the email door: Postmark inbound posts each message here.
 *
 * Unauthenticated by necessity, so the Basic credentials in the webhook URL are checked before the
 * payload is read. Each CSV, Excel or PDF attachment is registered for the agency whose address the
 * message was sent to; the same attachment twice (Postmark retries, a forwarded copy) is skipped.
 *
 *   · 200 when the message was handled, or can never be (no agency at that address, an agency whose
 *     plan or account cannot take files): retrying would not change it.
 *   · 401 for wrong credentials; 500 when unconfigured or when something failed and a retry may work.
 *
 * Limit: a serverless host accepts a request body of about 4.5 MB, and Postmark inlines attachments
 * in base64 (a third larger), so an email over roughly 3 MB of attachments needs the bucket door.
 */
export async function POST(request: NextRequest) {
  const auth = checkPostmarkBasicAuth(request.headers.get("authorization"));
  if (!auth.ok) {
    if (auth.status === 500) console.error(`[postmark-inbound] ${auth.reason}`);
    else console.warn(`[postmark-inbound] rejected: ${auth.reason}`);
    return NextResponse.json({ error: auth.status === 500 ? "Webhook not configured" : "Unauthorized" }, { status: auth.status });
  }

  const payload = (await request.json().catch(() => null)) as PostmarkInbound | null;
  if (!payload || typeof payload !== "object") return NextResponse.json({ ok: true, ignored: "unparseable" });

  try {
    const outcome = await receiveInboundEmail(payload);
    if (!outcome.handled) {
      if (outcome.reason === "schema_pending") return NextResponse.json({ error: "Not ready" }, { status: 500 });
      console.warn(`[postmark-inbound] not handled: ${outcome.reason}`);
      return NextResponse.json({ ok: true, ignored: outcome.reason });
    }
    for (const result of outcome.results) {
      await audit({
        actorType: "system",
        actorId: null,
        action: result.outcome === "skipped" ? "tenant.carrier_file_skipped" : "tenant.carrier_file_received",
        targetType: "carrier_file",
        targetId: result.fileId,
        metadata: { tenantId: outcome.tenantId, source: "email", status: result.outcome === "registered" ? result.status : "skipped", supersededFileId: result.outcome === "registered" ? result.supersededFileId : null },
        request,
      });
    }
    return NextResponse.json({ ok: true, files: outcome.results.length });
  } catch (error) {
    console.error("[postmark-inbound] failed:", error);
    return NextResponse.json({ error: "Could not take the message" }, { status: 500 });
  }
}
