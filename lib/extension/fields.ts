import "server-only";

import { buildCopyGroups } from "@/components/app/applications/copy-assist/copy-groups";
import { CANONICAL_GROUPS, isSensitiveKey } from "@/lib/applications/constants";
import { ApplicationError } from "@/lib/applications/db";
import { revealField } from "@/lib/applications/mutations";
import { getCaseView } from "@/lib/applications/service";
import type { AttemptView } from "@/lib/applications/types";
import { recordRead, type ExtensionContext } from "./grants";
import { fillableMapFor } from "./maps";
import { buildBulkPayload, type BulkPayload } from "./payload";
import { listTicks } from "./ticks";
import { applyTransform } from "./transforms";

/**
 * What the extension reads (LA-3.12 / 3.14): one bulk payload of NON-sensitive values, grouped the
 * way copy-assist groups them, plus the approved field map with each value already transformed; and,
 * one request per field, the SSN or a bank / card number — each written to the access log and the
 * audit log (by revealField, surface 'extension', action 'extension_read') before it is returned.
 */

const INPUT_BY_KEY = new Map(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.input] as const)));

/** The canonical values a map fills from, as the carrier would read them. Never a sensitive key. */
export function rawValues(attempt: AttemptView): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, fv] of Object.entries(attempt.values)) {
    if (isSensitiveKey(key) || fv.masked !== undefined) continue;
    const v = fv.value;
    if (v === null || v === undefined || v === "") continue;
    const input = INPUT_BY_KEY.get(key);
    if (input === "money" && typeof v === "number") {
      // Face amount in whole dollars; a premium keeps its cents. Integer cents in, strings out.
      out[key] = key === "cov.face_amount" ? String(Math.round(v / 100)) : `${Math.floor(v / 100)}.${String(Math.abs(v) % 100).padStart(2, "0")}`;
    } else {
      out[key] = v;
    }
  }
  if (!out["cov.product_tier"] && attempt.tier) out["cov.product_tier"] = attempt.tier;
  const p = attempt.payment;
  if (p) {
    out["pay.method"] = p.method;
    if (p.accountType) out["pay.account_type"] = p.accountType;
    if (p.bankName) out["pay.bank_name"] = p.bankName;
    if (p.nameOnAccount) out["pay.name_on_account"] = p.nameOnAccount;
    if (p.nameOnCard) out["pay.name_on_card"] = p.nameOnCard;
    if (p.card?.brand) out["pay.card_brand"] = p.card.brand;
    if (p.card?.expMonth && p.card?.expYear) out["pay.card_exp"] = `${String(p.card.expMonth).padStart(2, "0")}/${String(p.card.expYear).slice(-2)}`;
    out["pay.billing_frequency"] = p.billingFrequency ?? "monthly";
    if (p.draftDay) out["pay.draft_day"] = String(p.draftDay);
  }
  return out;
}

async function attemptFor(ctx: ExtensionContext) {
  const view = await getCaseView(ctx.tenantId, ctx.application.case_id);
  const attempt = view.attempts.find((a) => a.id === ctx.application.id);
  if (!attempt) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  return { view, attempt };
}

export async function readBulk(ctx: ExtensionContext): Promise<BulkPayload> {
  const { view, attempt } = await attemptFor(ctx);
  const [map, ticks] = await Promise.all([
    attempt.carrierId ? fillableMapFor(ctx.tenantId, attempt.carrierId, ctx.application.carrier_product_id, ctx.origin) : Promise.resolve(null),
    listTicks(ctx.tenantId, attempt.id),
  ]);
  const payload = buildBulkPayload({
    application: { id: attempt.id, attemptNo: attempt.attemptNo, clientName: view.clientName, carrierName: attempt.carrierName, productLabel: attempt.productLabel },
    grant: { id: ctx.grant.id, origin: ctx.origin, expiresAt: ctx.grant.expires_at },
    groups: buildCopyGroups(attempt),
    values: rawValues(attempt),
    map,
    ticks: ticks.map((t) => t.fieldKey),
  });
  await recordRead(ctx, Object.keys(payload.values).length, null);
  return payload;
}

/** One sensitive value. With `entryId`, transformed the way that map entry says. */
export async function readSensitive(ctx: ExtensionContext, fieldKey: string, entryId: string | null) {
  if (!isSensitiveKey(fieldKey)) throw new ApplicationError("FIELD_NOT_SENSITIVE", "Only the SSN and bank / card numbers are read one at a time — the rest come in the bulk read.", 400);
  let transform: string | null = null;
  let optionMap: Record<string, string> | null = null;
  if (entryId) {
    const map = ctx.application.carrier_id ? await fillableMapFor(ctx.tenantId, ctx.application.carrier_id, ctx.application.carrier_product_id, ctx.origin) : null;
    const entry = map?.entries.find((e) => e.id === entryId);
    if (!entry || entry.field_key !== fieldKey) throw new ApplicationError("FIELD_MAP_ENTRY_MISMATCH", "That map entry is not for this field.", 409);
    transform = entry.value_transform;
    optionMap = entry.option_map;
  }
  // The access record and the audit row are written first; a read that can't be recorded doesn't happen.
  const { value } = await revealField({ tenantId: ctx.tenantId, userId: ctx.userId, request: ctx.request }, ctx.application.id, fieldKey, "extension");
  await recordRead(ctx, 1, fieldKey);
  return { key: fieldKey, value: entryId ? applyTransform(value, transform, optionMap) : value };
}
