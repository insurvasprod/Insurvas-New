import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { recordSubmission } from "@/lib/applications/mutations";
import { runWelcomePack } from "@/lib/applications/welcomePack";
import { submissionSchema } from "@/lib/applications/schemas";

/**
 * LA-3.15 · the agent pressed submit on the carrier's site. Records the carrier's reference (it may
 * be empty — then it sits on Missing reference until filled), freezes the QA verdict and the health
 * picture onto the submission, and moves the attempt to `submitted`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, submissionSchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await recordSubmission(actor, id, { reference: input.reference ?? null, referenceKind: input.reference_kind, submittedAt: input.submitted_at ?? null, submittedVia: input.submitted_via, notes: input.notes ?? null });
    // LA-3.20 · the welcome pack is generated (and sent, if the tenant sends on submit) server-side,
    // so it never depends on the browser that pressed submit. It never sends twice.
    await runWelcomePack(actor, id, "submit").catch((error) => console.error("welcome pack on submit failed", error));
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
