import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { phoneLists, suppressionOverview } from "@/lib/suppression/overview";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import {
  LIST_TYPES,
  MANUAL_SOURCES,
  checkPhone,
  listSuppressions,
  suppressPhone,
  type SuppressionListType,
  type SuppressionSource,
} from "@/lib/suppression/service";

/**
 * LA-2.3 · the numbers this tenant must never call.
 *
 * Read is open to anyone who could be asked "are we allowed to call this person"; writing is not,
 * because a suppression cannot be undone. `prevent_suppression_removal` raises on DELETE and on
 * UPDATE of the number itself, so a typo suppresses a real stranger's phone permanently and takes
 * a migration to fix. That is the right amount of friction for the feature and the wrong amount
 * for a mistake, so the confirmation lives in the screen and the role gate lives here.
 */
const READ_ROLES = ["owner", "producer", "assistant", "setter"] as const;
const WRITE_ROLES = ["owner", "producer"] as const;

const addSchema = z
  .object({
    phone: z.string().trim().min(1, "Enter a phone number"),
    listType: z.enum(LIST_TYPES as [SuppressionListType, ...SuppressionListType[]]),
    reason: z.string().trim().min(1, "Say why this number is being suppressed").max(500, "That reason is too long"),
    // Only the sources a person can legitimately claim. `disposition`, `vendor` and `import` are
    // written by the paths that actually did those things, and letting a form assert one would
    // make the provenance column a guess rather than a record.
    source: z.enum(MANUAL_SOURCES as [SuppressionSource, ...SuppressionSource[]]),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", READ_ROLES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const check = params.get("check");

  // `?check=` answers one question — "may we call this number" — using the same function the
  // dialer calls. It is separate from the list because the list is a `like` match on digits and
  // would say "not found" for a number suppressed under a normalisation the search does not do.
  if (check) {
    try {
      // The verdict is the dialer's own function; the per-list rows only name where it came from.
      const [verdict, lists] = await Promise.all([checkPhone(auth.context.tenantId, check), phoneLists(auth.context.tenantId, check)]);
      return NextResponse.json({ ...verdict, lists, checkedAt: new Date().toISOString() }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not check that number" },
        { status: 400 },
      );
    }
  }

  // `?overview=1`: refused dials and feed health, for the figures and the Feed health card.
  if (params.get("overview")) {
    try {
      return NextResponse.json(await suppressionOverview(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load feed health" }, { status: 500 });
    }
  }

  const listType = params.get("listType");
  if (listType && !(LIST_TYPES as string[]).includes(listType))
    return NextResponse.json({ error: "That is not a suppression list", code: "invalid_list" }, { status: 400 });

  try {
    const page = await listSuppressions({
      tenantId: auth.context.tenantId,
      search: params.get("search"),
      listType: (listType as SuppressionListType | null) ?? null,
      limit: Number(params.get("limit")) || undefined,
    });
    return NextResponse.json(
      { ...page, canEdit: (WRITE_ROLES as readonly string[]).includes(auth.context.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the suppression list" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", WRITE_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid suppression" }, { status: 400 });

  try {
    const result = await suppressPhone({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      phone: parsed.data.phone,
      listType: parsed.data.listType,
      reason: parsed.data.reason,
      source: parsed.data.source,
    });

    // A write that reports success without the number actually being suppressed is the one outcome
    // this screen must never produce, because the person walks away believing a complaint has been
    // handled. `suppressPhone` reads the answer back through `is_phone_suppressed`, and this is
    // where that read is acted on rather than merely performed.
    if (!result.suppressed) {
      return NextResponse.json(
        {
          error:
            "The number was written but the dialer still reports it as callable. Nothing has been suppressed — please raise this rather than assuming it worked.",
          code: "suppression_not_effective",
        },
        { status: 500 },
      );
    }

    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.phone_suppressed",
      targetType: "tenant_suppression_list",
      targetId: result.phoneDigits,
      metadata: {
        listType: parsed.data.listType,
        source: parsed.data.source,
        reason: parsed.data.reason,
        // Suppression is permanent by design, so the audit row is the only record of who decided
        // it and why. It is not a convenience here; it is the paperwork.
        permanent: true,
      },
      request,
    });

    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not suppress that number" },
      { status: 400 },
    );
  }
}
