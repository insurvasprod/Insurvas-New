import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ActivityForbiddenError, activityCsv, getActivityReport, markActivityClick, markActivityDisposition } from "@/lib/activityLog/service";
import { parseFlagFilter } from "@/lib/activityLog/types";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const ROLES = ["owner", "producer", "setter"] as const;
const clickSchema = z.object({ action: z.literal("click"), activity_id: z.string().uuid() });
const dispositionSchema = z.object({ action: z.literal("disposition"), activity_id: z.string().uuid(), disposition: z.string().min(1).max(120), card_open_seconds: z.number().int().min(0).max(86400).nullable().optional(), notes: z.string().max(5000).nullable().optional() });

function filters(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const number = (key: string, fallback: number) => { const value = Number(query.get(key)); return Number.isInteger(value) ? value : fallback; };
  return { agentId: query.get("agent_id"), campaignId: query.get("campaign_id"), disposition: query.get("disposition"), from: query.get("from"), to: query.get("to"), page: number("page", 1), pageSize: number("page_size", 50), exportAll: query.get("format") === "csv", search: query.get("q"), integrityOnly: query.get("view") === "integrity", flag: parseFlagFilter(query.get("flag")), includeBlocked: query.get("blocked") !== "0" };
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const report = await getActivityReport(auth.context.tenantId, auth.context.userId, auth.context.role, filters(request));
    if (request.nextUrl.searchParams.get("format") === "csv") return new NextResponse(activityCsv(report.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=lead-activity.csv", "Cache-Control": "no-store" } });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ActivityForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load activity" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  try {
    const click = clickSchema.safeParse(body);
    if (click.success) return NextResponse.json(await markActivityClick(auth.context.tenantId, auth.context.userId, click.data.activity_id));
    const disposition = dispositionSchema.safeParse(body);
    if (disposition.success) return NextResponse.json(await markActivityDisposition(auth.context.tenantId, auth.context.userId, { activityId: disposition.data.activity_id, disposition: disposition.data.disposition, cardOpenSeconds: disposition.data.card_open_seconds, notes: disposition.data.notes }));
    return NextResponse.json({ error: "Choose a valid activity action" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update activity" }, { status: 400 }); }
}
