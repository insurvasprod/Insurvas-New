import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { EXPENSE_CATEGORIES } from "@/lib/accounting/expensesCore";
import { listAccounts } from "@/lib/accounting/bankStore";
import { LOCKED, loadAccountingSettings, recentChanges, saveAccountingSettings, SettingsError } from "@/lib/accounting/settingsStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.9 (Notion sprint) · accounting settings: read by owners and bookkeepers, changed by the
 * owner. The schema is strict and holds no field for a locked safety limit — recurring-expense
 * confirmation, bank auto-apply, outbound payments, the tax notice — so none can be switched off.
 */
const READ = ["owner", "bookkeeper"] as const;
const WRITE = ["owner"] as const;
const cents = z.number().int().min(0).max(100_000_000);
const patch = z.object({
  default_basis: z.enum(["accrual", "cash"]).optional(),
  fy_start_month: z.number().int().min(1).max(12).optional(),
  persistency_month: z.union([z.literal(3), z.literal(6), z.literal(9), z.literal(13)]).optional(),
  sample_threshold: z.number().int().min(1).max(1000).optional(),
  acquisition_defaults: z.record(z.enum(EXPENSE_CATEGORIES), z.boolean()).optional(),
  invoice_tolerance_cents: cents.optional(),
  payout_cadence: z.enum(["monthly", "semi_monthly", "weekly"]).optional(),
  payout_draft_days: z.number().int().min(0).max(28).optional(),
  payout_auto_publish: z.boolean().optional(),
  payout_statement_footer: z.string().trim().max(1000).nullable().optional(),
  payout_dispute_tolerance_cents: cents.optional(),
  producer_default_split_bp: z.number().int().min(0).max(10000).nullable().optional(),
  producer_default_basis: z.enum(["advance", "earned", "both"]).optional(),
  producer_negative_policy: z.enum(["carry_forward", "cap", "write_off"]).optional(),
  producer_recovery_cap_bp: z.number().int().min(1).max(10000).optional(),
  producers_see_balance: z.boolean().optional(),
  producer_share_fees: z.boolean().optional(),
  bank_amount_tolerance_cents: z.number().int().min(0).max(1_000_000).optional(),
  bank_window_days: z.number().int().min(1).max(120).optional(),
  tax_1099_threshold_cents: cents.optional(),
  tax_id_viewer_roles: z.array(z.enum(["owner", "bookkeeper"])).min(1).optional(),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof SettingsError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[accounting-settings]", error);
  return NextResponse.json({ error: "The settings could not be saved" }, { status: 500 });
};

export async function GET() {
  const auth = await requireFeatureRole("profit_and_loss", READ);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  try {
    const [settings, changes, accounts] = await Promise.all([loadAccountingSettings(tenantId), recentChanges(tenantId), listAccounts(tenantId).catch(() => [])]);
    return NextResponse.json({ settings, locked: LOCKED, changes, accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", WRITE, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That setting can't be changed." }, { status: 400 });
  const p = parsed.data;
  const { tenantId, userId } = auth.context;
  try {
    const changes = await saveAccountingSettings(tenantId, userId, {
      ...(p.default_basis !== undefined && { defaultBasis: p.default_basis }),
      ...(p.fy_start_month !== undefined && { fyStartMonth: p.fy_start_month }),
      ...(p.persistency_month !== undefined && { persistencyMonth: p.persistency_month }),
      ...(p.sample_threshold !== undefined && { sampleThreshold: p.sample_threshold }),
      ...(p.acquisition_defaults !== undefined && { acquisitionDefaults: p.acquisition_defaults as never }),
      ...(p.invoice_tolerance_cents !== undefined && { invoiceToleranceCents: p.invoice_tolerance_cents }),
      ...(p.payout_cadence !== undefined && { payoutCadence: p.payout_cadence }),
      ...(p.payout_draft_days !== undefined && { payoutDraftDays: p.payout_draft_days }),
      ...(p.payout_auto_publish !== undefined && { payoutAutoPublish: p.payout_auto_publish }),
      ...(p.payout_statement_footer !== undefined && { payoutStatementFooter: p.payout_statement_footer || null }),
      ...(p.payout_dispute_tolerance_cents !== undefined && { payoutDisputeToleranceCents: p.payout_dispute_tolerance_cents }),
      ...(p.producer_default_split_bp !== undefined && { producerDefaultSplitBp: p.producer_default_split_bp }),
      ...(p.producer_default_basis !== undefined && { producerDefaultBasis: p.producer_default_basis }),
      ...(p.producer_negative_policy !== undefined && { producerNegativePolicy: p.producer_negative_policy }),
      ...(p.producer_recovery_cap_bp !== undefined && { producerRecoveryCapBp: p.producer_recovery_cap_bp }),
      ...(p.producers_see_balance !== undefined && { producersSeeBalance: p.producers_see_balance }),
      ...(p.producer_share_fees !== undefined && { producerShareFees: p.producer_share_fees }),
      ...(p.bank_amount_tolerance_cents !== undefined && { bankAmountToleranceCents: p.bank_amount_tolerance_cents }),
      ...(p.bank_window_days !== undefined && { bankWindowDays: p.bank_window_days }),
      ...(p.tax_1099_threshold_cents !== undefined && { tax1099ThresholdCents: p.tax_1099_threshold_cents }),
      ...(p.tax_id_viewer_roles !== undefined && { taxIdViewerRoles: p.tax_id_viewer_roles }),
    });
    if (changes.length) await audit({ actorType: "tenant", actorId: userId, action: "accounting.settings_saved", targetType: "accounting_settings", targetId: tenantId, metadata: { tenantId, changes }, request });
    return NextResponse.json({ changes, settings: await loadAccountingSettings(tenantId) });
  } catch (error) {
    return fail(error);
  }
}
