import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { isRunnableSlug } from "@/lib/adminMonitoring/jobsView";
import { audit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";
// The longest job is given what the database's dispatcher gives it (60 s, 20261015500000).
export const maxDuration = 60;

type CronRoute = { GET: (request: Request) => Promise<Response> };

/**
 * Each app job's own route handler. Loaded only when asked for, so one run does not load every job. The keys are the
 * jobs Platform health names (lib/adminMonitoring/jobsView.ts RUNNABLE_SLUGS; jobsView.test.mjs holds the two equal).
 */
const CRON_ROUTES: Record<string, () => Promise<CronRoute>> = {
  "period-billing": () => import("@/app/api/cron/period-billing/route"),
  "metrics-daily": () => import("@/app/api/cron/metrics-daily/route"),
  "unclaimed-sla": () => import("@/app/api/cron/unclaimed-sla/route"),
  "invoices-overdue": () => import("@/app/api/cron/invoices-overdue/route"),
  "trial-reminders": () => import("@/app/api/cron/trial-reminders/route"),
  "notifications": () => import("@/app/api/cron/notifications/route"),
  "webhooks": () => import("@/app/api/cron/webhooks/route"),
  "callback-reminders": () => import("@/app/api/cron/callback-reminders/route"),
  "calendar-busy": () => import("@/app/api/cron/calendar-busy/route"),
  "licence-lapse": () => import("@/app/api/cron/licence-lapse/route"),
  "complaint-deadlines": () => import("@/app/api/cron/complaint-deadlines/route"),
  "compliance-monthly": () => import("@/app/api/cron/compliance-monthly/route"),
  "retention-summary": () => import("@/app/api/cron/retention-summary/route"),
  "deletion-perform": () => import("@/app/api/cron/deletion-perform/route"),
  "pipeline-rules": () => import("@/app/api/cron/pipeline-rules/route"),
};

const EXCERPT = 600;

/**
 * "Run now" on a job's sheet, Admin › Monitoring › Jobs & services (admin round 1, monitoring.html screen 6). Super
 * admin only. Runs one app job once, now, exactly as the database's scheduler would: the job's own /api/cron/<key>
 * handler, called in this server with the app's CRON_SECRET as the bearer — so the job's own fail-closed check runs,
 * and the secret never leaves the process (no network call, no address that could be pointed elsewhere). Every job is
 * idempotent by its own keys (20261015500000), so a run beside the scheduled one is harmless.
 *
 * Answers the job's own status and the start of its answer, and how long it took. Recorded in the audit log
 * (monitoring.job_run) with that outcome, whatever it was.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { key } = await params;
  const load = isRunnableSlug(key) ? CRON_ROUTES[key] : undefined;
  if (!load) return NextResponse.json({ error: "This job cannot be run from here." }, { status: 404 });

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on this app, so every job refuses every call, this one included. Set it, then try again." },
      { status: 503 },
    );
  }

  const path = `/api/cron/${key}`;
  const started = Date.now();
  let status: number;
  let excerpt: string;
  try {
    const route = await load();
    const response = await route.GET(new Request(new URL(path, request.nextUrl.origin), { method: "GET", headers: { authorization: `Bearer ${secret}` } }));
    status = response.status;
    excerpt = (await response.text().catch(() => "")).slice(0, EXCERPT);
  } catch (error) {
    console.error(`[monitoring/jobs] run ${path} threw`, error);
    status = 500;
    excerpt = error instanceof Error ? error.message.slice(0, EXCERPT) : "The job threw an error.";
  }
  const ms = Date.now() - started;
  const ok = status >= 200 && status < 300;

  await audit({
    actorId: auth.session.sub,
    action: "monitoring.job_run",
    targetType: "cron_job",
    targetId: path,
    metadata: { path, status, ok, ms },
    request,
  });

  return NextResponse.json({ ok, status, ms, excerpt });
}
