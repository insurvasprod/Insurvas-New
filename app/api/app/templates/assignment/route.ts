import { NextResponse } from "next/server";

import { requireFeature } from "@/lib/entitlements/requireFeature";
import { updateAgentTemplate } from "@/lib/agentTemplates/service";

export async function POST() {
  const auth = await requireFeature("book_of_business", { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const template = await updateAgentTemplate(auth.context.tenantId, auth.context.userId);
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update template" }, { status: 400 });
  }
}
