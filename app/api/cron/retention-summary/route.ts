import { NextResponse } from "next/server";

import { RECORD_TYPE_LABELS, type RecordType } from "@/lib/compliance/retention";
import { markSummarySent, pendingDryRunSummaries } from "@/lib/compliance/retentionStore";
import { retentionDryRunEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { shouldEmail } from "@/lib/notifications/preferences";

/**
 * LA-6.6 · the scheduled dry run's summary, emailed before the live run (the schedule itself is
 * pg_cron's la6-retention-daily). To the chosen recipients, else the tenant owners. Like the other
 * /api/cron routes it needs an outside scheduler and the CRON_SECRET bearer.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let sent = 0;
  for (const run of await pendingDryRunSummaries()) {
    let reached = 0;
    const { data: settings } = await db.from("compliance_settings").select("purge_summary_recipients, purge_dry_run_window_days").eq("tenant_id", run.tenant_id).maybeSingle();
    const chosen: string[] = settings?.purge_summary_recipients ?? [];
    const { data: people } = chosen.length
      ? await db.from("users").select("id, name, email, status").in("id", chosen)
      : await db.from("tenant_users").select("users!inner(id, name, email, status)").eq("tenant_id", run.tenant_id).eq("role", "owner").not("accepted_at", "is", null).then((r: { data: { users: unknown }[] | null }) => ({ data: (r.data ?? []).map((x) => x.users) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = ((run.results_json ?? []) as any[]).filter((r) => r.rows_matched > 0).map((r) => `${RECORD_TYPE_LABELS[r.record_type as RecordType] ?? r.record_type}: ${r.rows_matched - r.rows_held} to go${r.rows_held ? `, ${r.rows_held} held` : ""}${r.oldest ? ` (oldest ${String(r.oldest).slice(0, 10)})` : ""}`);
    const liveOn = new Date(Date.parse(run.finished_at) + Math.max(1, (settings?.purge_dry_run_window_days ?? 7) - 1) * 86_400_000).toISOString().slice(0, 10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((people ?? []) as any[]).filter((u) => u?.email && u.status === "active")) {
      // LA-8.4: the owner's own choice for "Record purge dry run ready".
      if (!(await shouldEmail({ userId: p.id, tenantId: run.tenant_id, eventKey: "retention_dry_run", title: "A record purge dry run is ready to review", link: "/app/compliance/settings#purge" }))) continue;
      const email = retentionDryRunEmail({ name: p.name ?? "there", lines, held: Number(run.held_count ?? 0), liveOn, settingsUrl: `${appUrl}/app/compliance/settings` });
      const delivery = await sendEmail({ to: p.email, ...email, templateKey: "compliance.retention_dry_run", userId: p.id, tenantId: run.tenant_id, dedupeKey: `retention-dry-run-${run.id}-${p.id}` });
      if (delivery.delivered) {
        sent += 1;
        reached += 1;
      }
    }
    // How many it reached: nobody means the scheduled live run will not follow (LA-6.6, 20261015630000).
    await markSummarySent(run.id, reached);
  }
  return NextResponse.json({ ok: true, sent });
}
