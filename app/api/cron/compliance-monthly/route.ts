import { NextResponse } from "next/server";

import { loadComplianceDashboard } from "@/lib/compliance/dashboard";
import { bookLine } from "@/lib/compliance/evidenceGaps";
import { bookGapScan } from "@/lib/compliance/evidenceReport";
import { complianceMonthlyEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { shouldEmail } from "@/lib/notifications/preferences";

/**
 * LA-6.7 · once a month, the dashboard's coverage figures and the book-wide gap scan, emailed —
 * because the agent who most needs the screen is the one who never opens it. Switched off per tenant
 * in compliance settings (LA-6.8). One email per person per month (dedupe key). Needs an outside
 * scheduler and the CRON_SECRET bearer, like the other /api/cron routes; safe to call daily.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const month = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  // Tenants that hold compliance records: the nightly reconciliation writes a row only for those.
  const { data: recent } = await db.from("compliance_index_reconciliation").select("tenant_id").gte("ran_at", new Date(now.getTime() - 3 * 86_400_000).toISOString()).limit(5000);
  const tenants = [...new Set(((recent ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id))];
  let sent = 0;
  for (const tenantId of tenants) {
    const { data: settings } = await db.from("compliance_settings").select("dashboard_monthly_email, dashboard_email_recipients").eq("tenant_id", tenantId).maybeSingle();
    if (settings && settings.dashboard_monthly_email === false) continue;
    const chosen: string[] = Array.isArray(settings?.dashboard_email_recipients) ? settings.dashboard_email_recipients : [];
    const { data: owners } = await db.from("tenant_users").select("user_id, users!inner(id, name, email, status)").eq("tenant_id", tenantId).eq("role", "owner").not("accepted_at", "is", null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerUsers = ((owners ?? []) as any[]).map((o) => o.users).filter((u) => u?.status === "active" && u.email);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recipients: any[] = chosen.length ? (((await db.from("users").select("id, name, email, status").in("id", chosen)).data ?? []) as any[]).filter((u) => u.status === "active" && u.email) : ownerUsers;
    if (!recipients.length || !ownerUsers.length) continue;
    const viewer = { tenantId, userId: ownerUsers[0].id as string, role: "owner" };
    const [dash, scan] = await Promise.all([loadComplianceDashboard(viewer, now), bookGapScan(viewer, {}, { log: false, numbers: false }).catch(() => null)]);
    const coverage = dash.tiles.map((t) => `${t.label}: ${t.value ?? "not configured"}${t.footnote && t.value ? ` (${t.footnote})` : ""}`);
    const gaps = scan ? scan.lines.filter((l) => l.numbers > 0 || l.count > 0).map(bookLine) : ["The gap scan could not run: it needs a database update."];
    const keys = recipients.map((p) => `compliance-monthly-${monthKey}-${tenantId}-${p.id}`);
    const { data: already } = await db.from("email_log").select("dedupe_key").in("dedupe_key", keys);
    const done = new Set(((already ?? []) as { dedupe_key: string }[]).map((r) => r.dedupe_key));
    for (const person of recipients) {
      if (done.has(`compliance-monthly-${monthKey}-${tenantId}-${person.id}`)) continue;
      // LA-8.4: the person's own choice for "Monthly compliance summary".
      if (!(await shouldEmail({ userId: person.id, tenantId, eventKey: "compliance_monthly", title: `Compliance summary for ${month}`, link: "/app/compliance" }))) continue;
      const email = complianceMonthlyEmail({ name: person.name ?? "there", month, coverage, gaps, dashboardUrl: `${appUrl}/app/compliance` });
      const delivery = await sendEmail({ to: person.email, ...email, templateKey: "compliance.monthly_digest", userId: person.id, tenantId, dedupeKey: `compliance-monthly-${monthKey}-${tenantId}-${person.id}` });
      if (delivery.delivered) sent += 1;
    }
  }
  return NextResponse.json({ ok: true, tenants: tenants.length, sent });
}
