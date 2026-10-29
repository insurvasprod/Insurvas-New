import { NextResponse } from "next/server";
import { z } from "zod";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { discardDraft, disclosureInputSchema, retireDisclosure, saveDisclosure } from "@/lib/salesSettings/disclosures";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const notFound = () => NextResponse.json({ error: "That disclosure could not be found." }, { status: 404 });

/**
 * LA-3.10 · save a disclosure (owners). A draft is saved in place; a published version is never
 * changed — the edit becomes version N + 1 as a draft. DELETE discards a draft (only a draft).
 * PATCH `{ status: "retired" }` retires a published version (it stays on the applications that
 * acknowledged it).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const input = await body(request, disclosureInputSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ item: await saveDisclosure(actorOf(auth, request), id, input) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    return NextResponse.json(await discardDraft(actorOf(auth, request), id));
  } catch (error) {
    return failure(error);
  }
}

const retireSchema = z.object({ status: z.literal("retired") }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const input = await body(request, retireSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ item: await retireDisclosure(actorOf(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}
