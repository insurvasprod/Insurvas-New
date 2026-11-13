import { NextResponse, type NextRequest } from "next/server";

import { openInstructions } from "@/lib/leadPost/boardStore";
import { guideHtml } from "@/lib/leadPost/guide";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/post/<workspace>/guide/<token> — the vendor's instructions as a page (round 8, "Copy link
 * to this page"). Public by design, like the posting URL beside it: the token is the permission, and
 * only its hash is stored. Each open is counted so the sheet can say "opened twice". The page never
 * holds the key itself.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ workspace: string; token: string }> }) {
  const { workspace, token } = await context.params;
  const notFound = () => new NextResponse("This link is not valid any more. Ask the agency for a new one.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!UUID.test(workspace)) return notFound();
  const found = await openInstructions(workspace.toLowerCase(), token).catch(() => null);
  if (!found) return notFound();
  const html = guideHtml({ ...found, postingUrl: `${request.nextUrl.origin}/api/post/${workspace.toLowerCase()}` });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
