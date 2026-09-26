import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import {
  consentCertificatesFor,
  ExemptionRefusedError,
  ExemptionSchemaPendingError,
  listExemptions,
  recordExemption,
  revokeExemption,
} from "@/lib/suppression/exemptions";

/**
 * LA-2.3-3 · the exemptions that clear federal/state DNC for one number.
 *
 * Read is the same audience as the suppression list (anyone who may be asked "can we call this
 * person"); recording and revoking are the owner's alone (user decision, 2026-09-25). The rules —
 * a stored certificate for written consent, the 18-month / 3-month relationship windows, one open
 * record per number, never the agency's own list or a litigator — are enforced by the database
 * functions this calls (20260925709700), not here.
 */
const READ_ROLES = ["owner", "producer", "assistant", "setter"] as const;
const WRITE_ROLES = ["owner"] as const;

const recordSchema = z.discriminatedUnion("basis", [
  z.object({
    basis: z.literal("written_consent"),
    phone: z.string().trim().min(1, "Enter a phone number"),
    consentArtefactId: z.string().uuid("Pick the stored consent certificate"),
    note: z.string().trim().max(500, "That note is too long").optional(),
  }).strict(),
  z.object({
    basis: z.literal("existing_business_relationship"),
    phone: z.string().trim().min(1, "Enter a phone number"),
    relationshipKind: z.enum(["purchase", "inquiry"]),
    relationshipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the relationship date"),
    note: z.string().trim().max(500, "That note is too long").optional(),
  }).strict(),
]);

const revokeSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "Say why the exemption is being revoked").max(500, "That reason is too long"),
}).strict();

function failure(error: unknown, fallback: string) {
  if (error instanceof ExemptionSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
  if (error instanceof ExemptionRefusedError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", READ_ROLES);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  try {
    // `?certificates=<phone>`: the consent certificates on leads with this number, for the form.
    const certificatesFor = params.get("certificates");
    if (certificatesFor) {
      return NextResponse.json({ certificates: await consentCertificatesFor(auth.context.tenantId, certificatesFor) }, { headers: { "Cache-Control": "no-store" } });
    }
    const loaded = await listExemptions(auth.context.tenantId, { phone: params.get("phone") });
    return NextResponse.json(
      { ...loaded, canEdit: (WRITE_ROLES as readonly string[]).includes(auth.context.role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error, "Could not load DNC exemptions");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", WRITE_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = recordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid exemption" }, { status: 400 });
  const body = parsed.data;
  try {
    const saved = await recordExemption({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      phone: body.phone,
      basis: body.basis,
      consentArtefactId: body.basis === "written_consent" ? body.consentArtefactId : null,
      relationshipKind: body.basis === "existing_business_relationship" ? body.relationshipKind : null,
      relationshipDate: body.basis === "existing_business_relationship" ? body.relationshipDate : null,
      note: body.note ?? null,
    });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.dnc_exemption_recorded",
      targetType: "tenant_dnc_exemptions",
      targetId: saved.id,
      metadata: {
        tenantId: auth.context.tenantId,
        phoneDigits: saved.phoneDigits,
        basis: saved.basis,
        relationshipKind: saved.relationshipKind,
        relationshipDate: saved.relationshipDate,
        expiresAt: saved.expiresAt,
        consentArtefactId: saved.consentArtefactId,
        // What it can and cannot clear, written into the record of the decision itself.
        clears: ["federal_dnc", "state_dnc"],
      },
      request,
    });
    return NextResponse.json({ exemption: saved }, { status: 201 });
  } catch (error) {
    return failure(error, "Could not record the exemption");
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", WRITE_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Send the exemption and a reason" }, { status: 400 });
  try {
    const revoked = await revokeExemption({ tenantId: auth.context.tenantId, userId: auth.context.userId, exemptionId: parsed.data.id, reason: parsed.data.reason });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.dnc_exemption_revoked",
      targetType: "tenant_dnc_exemptions",
      targetId: parsed.data.id,
      metadata: { tenantId: auth.context.tenantId, phoneDigits: revoked?.phoneDigits ?? null, reason: parsed.data.reason },
      request,
    });
    return NextResponse.json({ exemption: revoked });
  } catch (error) {
    return failure(error, "Could not revoke the exemption");
  }
}
