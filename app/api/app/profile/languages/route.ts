import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { OwnLanguagesPendingError, readOwnLanguages, saveOwnLanguages } from "@/lib/assignment/ownLanguages";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * Settings › My profile › Languages I speak (owner, 2026-10-27). The signed-in person's own
 * languages: the same saved value (agent_capacity.languages) a manager edits in Lead routing › Team,
 * which routing and Inbound read to offer callers who speak them first. The person comes only from
 * the verified session, never from the body.
 */
const schema = z.object({
  languages: z.array(z.string().trim().min(2, "A language needs at least two letters").max(40, "Keep a language under 40 characters")).max(12, "Choose up to 12 languages"),
}).strict();

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  try {
    const languages = await readOwnLanguages(auth.context.tenantId, auth.context.userId);
    return NextResponse.json({ languages: languages ?? [], available: languages !== null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Your languages could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the languages." }, { status: 400 });
  try {
    const languages = await saveOwnLanguages(auth.context.tenantId, auth.context.userId, parsed.data.languages);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.own_profile_updated",
      targetType: "user",
      targetId: auth.context.userId,
      metadata: { tenantId: auth.context.tenantId, fields: ["languages"], languages },
      request,
    });
    return NextResponse.json({ languages });
  } catch (error) {
    if (error instanceof OwnLanguagesPendingError) return NextResponse.json({ error: "Languages need a database update that has not been applied yet." }, { status: 503 });
    return NextResponse.json({ error: "Your languages could not be saved. Try again." }, { status: 500 });
  }
}
