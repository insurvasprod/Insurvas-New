import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_INVOICES } from "@/lib/invoices/permissions";
import { findDueSubscriptions, runPeriodBilling } from "@/lib/billing/periodRun";
import { audit } from "@/lib/audit/log";

/**
 * Run the period billing job, or preview what it would do (backlog #44).
 *
 * The job is meant to be scheduled, and until SA-6.1 schedules it nothing does — backlog #24 makes
 * the point that a job which silently never runs looks exactly like a healthy one. A button that a
 * billing admin can press is not a substitute for a scheduler, but it does mean the run is
 * something a person can see, trigger and check rather than an SSH session away.
 *
 * Deliberately does NOT advance billing periods. The command-line job does both in the right order;
 * rolling every subscription's period from a web request is a much larger action than the button
 * says, and the two belong together only where their ordering can be guaranteed.
 */
const schema = z.object({ dry_run: z.boolean().optional() });

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_INVOICES);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (parsed.data.dry_run) {
    const due = await findDueSubscriptions();
    return NextResponse.json({
      dryRun: true,
      due: due.map((s) => ({
        subscriptionId: s.id,
        tenant: s.tenant_name,
        periodStart: s.current_period_start,
        periodEnd: s.current_period_end,
      })),
    });
  }

  const outcomes = await runPeriodBilling({ createdBy: auth.session.sub });

  const raised = outcomes.filter((o) => o.invoiceId);
  const failed = outcomes.filter((o) => o.error);

  await audit({
    actorId: auth.session.sub,
    action: "billing.period_run",
    targetType: "billing_run",
    targetId: new Date().toISOString().slice(0, 10),
    metadata: {
      considered: outcomes.length,
      invoicesRaised: raised.length,
      totalCents: raised.reduce((sum, o) => sum + o.totalCents, 0),
      creditAppliedCents: outcomes.reduce((sum, o) => sum + o.creditAppliedCents, 0),
      failures: failed.map((o) => ({ subscriptionId: o.subscriptionId, error: o.error })),
    },
    request,
  });

  return NextResponse.json({
    considered: outcomes.length,
    invoicesRaised: raised.length,
    totalCents: raised.reduce((sum, o) => sum + o.totalCents, 0),
    creditAppliedCents: outcomes.reduce((sum, o) => sum + o.creditAppliedCents, 0),
    // Every outcome, not just the successes. A run where nothing was billable and a run where
    // everything failed both raise zero invoices, and they need to look different.
    outcomes: outcomes.map((o) => ({
      subscriptionId: o.subscriptionId,
      tenant: o.tenantName,
      invoiceNumber: o.invoiceNumber,
      totalCents: o.totalCents,
      lineCount: o.lineCount,
      creditAppliedCents: o.creditAppliedCents,
      alreadyBilled: o.alreadyBilled,
      skippedAddons: o.skippedAddons,
      error: o.error,
    })),
  });
}
