import { NextResponse, type NextRequest } from "next/server";

import { fetchPublicPlans } from "@/lib/publicPlans/queries";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rule: RateLimitRule = {
    name: "public_plans_ip",
    max: await getSetting<number>("security.public_plans_per_minute"),
    windowSeconds: 60,
  };
  const limited = await claim(rule, callerIp(request.headers));
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many pricing requests. Please try again shortly." }, {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds(limited.rule)), "cache-control": "no-store" },
    });
  }
  try {
    const plans = await fetchPublicPlans();
    return NextResponse.json(plans, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not serve public plans", error);
    return NextResponse.json({ error: "Pricing is temporarily unavailable" }, { status: 503 });
  }
}
