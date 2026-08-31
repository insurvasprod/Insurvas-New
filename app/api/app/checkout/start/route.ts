import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveSignupContext } from "@/lib/signup/context";
import { CheckoutError, startCheckout } from "@/lib/checkout/start";

const schema = z.object({ couponCode: z.string().trim().max(40).optional() });

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "active") {
    return NextResponse.json({ error: "Verify your email address first" }, { status: 409 });
  }

  const parsed = schema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const checkout = await startCheckout(context.tenantId, parsed.data.couponCode);
    return NextResponse.json(checkout);
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[checkout] could not start:", error);
    return NextResponse.json({ error: "Could not open checkout" }, { status: 500 });
  }
}
