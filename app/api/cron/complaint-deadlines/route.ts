import { NextResponse } from "next/server";

import { sendComplaintDeadlineEmails } from "@/lib/compliance/complaintDigest";

/**
 * LA-6.4 · daily: an email to the owner and the tenant admins for every regulator complaint inside
 * its red window or overdue. Like the other /api/cron routes it needs an outside scheduler
 * (vercel.json has no crons since b37d0bf) and the CRON_SECRET bearer.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendComplaintDeadlineEmails();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
