import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { ADDON_GRANTS_LOCKED_MESSAGE, ADDON_PRICE_LOCKED_MESSAGE } from "./constants";
import { mergePlanAvailability } from "./catalogView";
import { countBilledAttachments, fetchAddonPlanIds, fetchPlanRefs } from "./queries";
import type { CreateAddonInput, UpdateAddonInput } from "./schemas";

type RpcError = { code?: string; message?: string } | null;
type RpcResult = { data: string | null; error: RpcError };

/**
 * The catalog tables are service-role-only. The RPC is the transaction boundary that validates
 * all referenced features/meters/plans and replaces the three child sets atomically.
 */
export async function upsertAddon(input: CreateAddonInput | UpdateAddonInput, addonId?: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const rpcClient = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> };
  const { data, error } = await rpcClient.rpc("admin_upsert_addon", {
    p_addon_id: addonId ?? null,
    p_code: "code" in input ? input.code : null,
    p_name: input.name,
    p_description: input.description || null,
    p_price_cents: input.price_cents,
    p_billing_cycle: input.billing_cycle,
    p_is_active: "is_active" in input ? input.is_active : true,
    p_sort_order: input.sort_order,
    p_feature_keys: input.feature_keys,
    p_meters: input.meters,
    p_plan_ids: input.plan_ids,
  });
  if (error) throw new Error(`${error.code ?? "rpc_error"}:${error.message ?? "Add-on catalog mutation failed"}`);
  if (!data) throw new Error("Add-on catalog mutation returned no id");
  return data;
}

export type AddonBefore = { id: string; code: string; price_cents: number; billing_cycle: string };

/**
 * The two rules the RPC enforces from 20260924352000, enforced here too so they hold before that
 * migration is applied (and are harmless after it):
 *
 * - price and billing cycle are locked while the billing run still invoices the add-on somewhere;
 * - availability rows for OLDER plan versions — which the editor never lists — survive the save.
 *
 * A failed read refuses the edit: guessing "no attachments" is how a live price would change.
 */
export async function prepareAddonUpdate(
  before: AddonBefore,
  input: UpdateAddonInput,
): Promise<{ ok: true; input: UpdateAddonInput } | { ok: false; status: number; message: string }> {
  const priceChanged = input.price_cents !== before.price_cents || input.billing_cycle !== before.billing_cycle;
  try {
    if (priceChanged && (await countBilledAttachments(before.id)) > 0) {
      return { ok: false, status: 409, message: ADDON_PRICE_LOCKED_MESSAGE };
    }
    const [existing, plans] = await Promise.all([fetchAddonPlanIds(before.id), fetchPlanRefs()]);
    return { ok: true, input: { ...input, plan_ids: mergePlanAvailability(input.plan_ids, existing, plans) } };
  } catch {
    return { ok: false, status: 500, message: "Could not check this add-on's live attachments, so nothing was saved. Try again." };
  }
}

export function addonMutationError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : "";
  // The lock refusals first: they are specific, and must never be mistaken for a missing function.
  if (/addon_price_has_live_attachments/i.test(message)) return { status: 409, message: ADDON_PRICE_LOCKED_MESSAGE };
  if (/addon_grants_have_live_attachments/i.test(message)) return { status: 409, message: ADDON_GRANTS_LOCKED_MESSAGE };
  if (/admin_upsert_addon|does not exist|schema cache|42883|PGRST202/i.test(message)) {
    return { status: 503, message: "Add-on catalog editing is unavailable until the additive database migration is applied." };
  }
  if (/feature_not_found|meter_not_found|plan_not_found|code_immutable/i.test(message)) {
    return { status: 409, message: "The add-on references an invalid or currently protected catalog item." };
  }
  if (/duplicate|23505/i.test(message)) return { status: 409, message: "An add-on with that code already exists." };
  return { status: 500, message: "Could not save the add-on catalog entry." };
}
