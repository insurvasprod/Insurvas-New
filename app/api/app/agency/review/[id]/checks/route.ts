import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { reviewChecks } from "@/lib/agency/reviewStore";
import { canSeeProducerRow } from "@/lib/agency/visibility";
import { NO_STORE } from "@/lib/agency/http";

/** AG-1.11 · LA-3's own check results for one sampled application — the same verdict the submission gate uses. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_qa", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That review could not be found." }, { status: 404 });
  const { data: review } = await getSupabaseServiceClient().from("application_review" as never).select("application_id, producer_user_id").eq("tenant_id", auth.context.tenantId).eq("id", id).maybeSingle<{ application_id: string; producer_user_id: string }>();
  if (!review || !(await canSeeProducerRow(auth.context, review.producer_user_id))) return NextResponse.json({ error: "That review could not be found." }, { status: 404 });
  const verdict = await reviewChecks(auth.context.tenantId, review.application_id);
  return NextResponse.json({ applicationId: review.application_id, verdict }, { headers: NO_STORE });
}
