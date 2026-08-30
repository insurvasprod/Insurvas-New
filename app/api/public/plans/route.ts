import { NextResponse } from "next/server";

import { fetchPublicPlans } from "@/lib/publicPlans/queries";

export const dynamic = "force-dynamic";

export async function GET() {
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
