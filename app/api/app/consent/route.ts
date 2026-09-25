import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getConsentLocker, getConsentRecord, type ConsentStatus } from "@/lib/consent/locker";
import { audit } from "@/lib/audit/log";
import { EVIDENCE_LABEL, type EvidenceFilter } from "@/lib/consent/evidence";
import { evidenceCsv, getConsentEvidence, type EvidenceSource } from "@/lib/consent/evidenceService";

/**
 * LA-2.6 · the consent locker, read-only.
 *
 * There is no write here on purpose. A consent artefact records what a vendor supplied and what we
 * managed to claim; it is evidence, and an endpoint that let somebody edit it would turn the
 * locker into a place where evidence can be improved after the fact. Rows arrive from the lead-post
 * ingest and are upgraded to `claimed` by the claim job. This route lets people find and read them.
 */
const ROLES = ["owner", "producer", "assistant"] as const;
const STATUSES: ConsentStatus[] = ["pending", "claimed", "expired", "failed"];
const FILTERS: EvidenceFilter[] = ["every", "full", "no_ip", "no_text", "none"];
const SOURCES: EvidenceSource[] = ["partner", "vendor", "direct"];
/** The most one export carries. A locker bigger than this is exported a filter at a time. */
const EXPORT_CAP = 10_000;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("consent_locker", ROLES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const id = params.get("id");

  if (id) {
    if (!z.string().uuid().safeParse(id).success)
      return NextResponse.json({ error: "That is not a certificate id", code: "invalid_id" }, { status: 400 });
    try {
      return NextResponse.json(
        { record: await getConsentRecord(auth.context.tenantId, id) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not load that certificate" },
        { status: 404 },
      );
    }
  }

  // The locker by lead (p-app-consent): every lead and the best evidence it has, and its CSV.
  if (params.get("view") === "leads") {
    const filter = (params.get("evidence") ?? "every") as EvidenceFilter;
    if (!FILTERS.includes(filter)) return NextResponse.json({ error: "That is not an evidence filter", code: "invalid_filter" }, { status: 400 });
    const sources = (params.get("sources") ?? "").split(",").filter(Boolean) as EvidenceSource[];
    if (sources.some((source) => !SOURCES.includes(source))) return NextResponse.json({ error: "That is not a lead source", code: "invalid_source" }, { status: 400 });
    const csv = params.get("format") === "csv";
    try {
      const view = await getConsentEvidence({
        tenantId: auth.context.tenantId,
        filter,
        sources,
        search: params.get("search"),
        page: csv ? 0 : Math.max(0, Number(params.get("page")) || 0),
        pageSize: csv ? EXPORT_CAP : 50,
      });
      if (!csv) return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
      // Evidence leaving the product is recorded: who took it, which slice, and how many rows.
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.consent_evidence_exported", targetType: "tenant", targetId: auth.context.tenantId, metadata: { filter, sources, search: params.get("search") ?? null, rows: view.rows.length, capped: view.total > view.rows.length }, request });
      return new NextResponse(evidenceCsv(view.rows, (level) => EVIDENCE_LABEL[level]), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="consent-evidence-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load consent evidence" }, { status: 500 });
    }
  }

  const status = params.get("status");
  if (status && !STATUSES.includes(status as ConsentStatus))
    return NextResponse.json({ error: "That is not a capture status", code: "invalid_status" }, { status: 400 });

  try {
    const view = await getConsentLocker({
      tenantId: auth.context.tenantId,
      search: params.get("search"),
      status: (status as ConsentStatus | null) ?? null,
      limit: Number(params.get("limit")) || undefined,
    });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the consent locker" },
      { status: 500 },
    );
  }
}
