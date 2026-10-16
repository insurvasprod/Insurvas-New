import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { EXEMPT_REASONS, ENTITY_TYPES, TAX_CATEGORIES, TIN_TYPES } from "@/lib/accounting/taxCore";
import { categoryMap, categoryTotals, contractors, revealTaxId, saveProfile, setCategory, TaxError, taxSettings } from "@/lib/accounting/taxStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { secondFactorBlock } from "@/lib/tenantAuth/twoFactor";

/**
 * LA-7.8 (Notion sprint) · tax figures: the year's contractor list (on payment dates), the
 * category totals and mapping, payee tax details (tax IDs masked; a reveal is audited and limited
 * to the roles the agency allows), and category overrides. Figures, never advice; nothing is filed.
 * Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const uuid = z.string().uuid();
const body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("save_profile"), payee_type: z.enum(["partner", "producer", "vendor"]), payee_id: uuid, legal_name: z.string().trim().max(200).nullable(),
    tax_id_type: z.enum(TIN_TYPES), tax_id: z.string().trim().max(40).nullable(), entity_type: z.enum(ENTITY_TYPES).nullable(),
    address_line1: z.string().trim().max(200).nullable(), address_line2: z.string().trim().max(200).nullable(), city: z.string().trim().max(100).nullable(),
    state: z.string().trim().max(40).nullable(), postal_code: z.string().trim().max(20).nullable(), country: z.string().trim().length(2),
    w9_on_file: z.boolean(), exempt_reason: z.enum(EXEMPT_REASONS).nullable(),
  }).strict(),
  z.object({ op: z.literal("reveal"), profile_id: uuid }).strict(),
  z.object({ op: z.literal("set_category"), source_type: z.enum(["cost_entry_type", "expense_category", "commission_entry_type"]), source_value: z.string().regex(/^[a-z_]{2,40}$/), tax_category: z.enum(TAX_CATEGORIES) }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof TaxError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[tax]", error);
  return NextResponse.json({ error: "That didn't work" }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("tax_summaries", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId, role } = auth.context;
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Choose a year." }, { status: 400 });
  try {
    const settings = await taxSettings(tenantId);
    const [people, totals, map] = await Promise.all([contractors(tenantId, year), categoryTotals(tenantId, year, settings.basis), categoryMap(tenantId)]);
    return NextResponse.json({ year, basis: settings.basis, canReveal: settings.viewerRoles.includes(role), contractors: people, totals, map }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tax_summaries", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  const b = parsed.data;
  try {
    if (b.op === "reveal") {
      // LA-8.2: a payee's tax ID is often their SSN; whoever the agency allows still needs two-factor.
      const blocked = await secondFactorBlock(auth.context);
      if (blocked) return blocked;
      const value = await revealTaxId(tenantId, userId, role, b.profile_id, request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.tax_id_revealed", targetType: "payee_tax_profile", targetId: b.profile_id, metadata: { tenantId }, request });
      return NextResponse.json({ value }, { headers: { "Cache-Control": "no-store" } });
    }
    if (b.op === "set_category") {
      // The mapping and its accounting_setting_change row are one write (from, to, who); this is the platform audit beside it.
      const change = await setCategory(tenantId, userId, b.source_type, b.source_value, b.tax_category);
      if (change.changed) await audit({ actorType: "tenant", actorId: userId, action: "accounting.settings_saved", targetType: "tax_category_map", targetId: `${b.source_type}:${b.source_value}`, metadata: { tenantId, from: change.from, to: change.to }, request });
      return NextResponse.json({ ok: true, changed: change.changed });
    }
    const id = await saveProfile(tenantId, userId, {
      payeeType: b.payee_type, payeeId: b.payee_id, legalName: b.legal_name, taxIdType: b.tax_id_type, taxId: b.tax_id, entityType: b.entity_type,
      addressLine1: b.address_line1, addressLine2: b.address_line2, city: b.city, state: b.state, postalCode: b.postal_code, country: b.country, w9OnFile: b.w9_on_file, exemptReason: b.exempt_reason,
    });
    // The tax ID itself never goes into the audit row.
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.tax_profile_saved", targetType: "payee_tax_profile", targetId: id, metadata: { tenantId, payeeType: b.payee_type, taxIdChanged: !!b.tax_id }, request });
    return NextResponse.json({ id });
  } catch (error) {
    return fail(error);
  }
}
