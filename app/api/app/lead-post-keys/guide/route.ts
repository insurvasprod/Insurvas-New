import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guideInputFor } from "@/lib/leadPost/boardStore";
import { guideText } from "@/lib/leadPost/guide";
import { buildGuidePdf } from "@/lib/leadPost/guidePdf";

/**
 * Round 8 · the vendor's instructions, for the owner to copy or download: `?key=<id>` for one
 * vendor (their field names, campaign), none for the general vendor guide. `format=pdf` answers a
 * PDF; otherwise the plain text. Reading, so a read-only owner may download it.
 */
const ROLES = ["owner"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  const key = params.get("key");
  if (key && !z.string().uuid().safeParse(key).success) return NextResponse.json({ error: "That is not a key id" }, { status: 400 });
  try {
    const base = await guideInputFor(auth.context.tenantId, key);
    const input = { ...base, postingUrl: `${request.nextUrl.origin}/api/post/${auth.context.tenantId}` };
    if (params.get("format") === "pdf") {
      const bytes = await buildGuidePdf(input);
      const slug = (base.vendorName ?? "vendor").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vendor";
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="posting-instructions-${slug}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ text: guideText(input), input }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The instructions could not be made" }, { status: 500 });
  }
}
