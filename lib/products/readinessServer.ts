import "server-only";

import { db, isMissingSchema, rows } from "@/lib/applications/db";
import type { StoredDefinition } from "@/lib/applications/templates";
import { carrierIdsOn } from "@/lib/carriers/agency";
import { getEntitlement } from "@/lib/entitlements/get";

import type { ProductFacts, ReadinessPayload } from "./readiness";

/**
 * Settings › Products, round 8: the facts behind "What it needs" for every catalogue product, read from where
 * each thing is set up — the agency's application forms (tenant_templates), its switched-on carriers that
 * offer the product (carrier_products), the published health questions and quote inputs made for the
 * product (sales_templates, the agency's own or Insurvas's), and the plans on sale that add a locked product.
 * Read only. A source that is missing or fails leaves its part empty rather than failing the page.
 */

type TemplateRow = { tenant_id: string | null; kind: string; product_code: string; carrier_id: string | null; name: string; version: number; definition: StoredDefinition | null };

function knockouts(def: StoredDefinition | null): number {
  let n = 0;
  for (const section of def?.form_definition?.sections ?? []) for (const field of section.fields ?? []) if (field.is_knockout) n += 1;
  return n;
}

/** The template a call for this product loads when no carrier has its own: the agency's, then Insurvas's. */
function bestFor(list: TemplateRow[], kind: string, code: string): TemplateRow | null {
  const mine = list.filter((t) => t.kind === kind && t.product_code === code);
  const newest = (xs: TemplateRow[]) => [...xs].sort((a, b) => b.version - a.version)[0] ?? null;
  return newest(mine.filter((t) => !t.carrier_id && t.tenant_id)) ?? newest(mine.filter((t) => !t.carrier_id && !t.tenant_id))
    ?? newest(mine.filter((t) => t.tenant_id)) ?? newest(mine);
}

async function plansAdding(tenantId: string): Promise<{ planName: string | null; addedBy: Record<string, string[]> }> {
  const entitlement = await getEntitlement(tenantId);
  const client = db();
  let planName = entitlement.plan_name ?? null;
  let planType: string | null = null;
  let currentCode: string | null = entitlement.plan_code ?? null;
  if (entitlement.plan_code) {
    const current = await client.from("plans").select("name, plan_type, code").eq("code", entitlement.plan_code).eq("version", entitlement.plan_version ?? 1).maybeSingle();
    if (!current.error && current.data) {
      planName = planName ?? (current.data.name as string);
      planType = (current.data.plan_type as string | null) ?? null;
      currentCode = current.data.code as string;
    }
  }
  const listed = await client.from("plans").select("id, code, name, plan_type, sort_order, version").eq("is_public", true).eq("is_archived", false).order("version", { ascending: false });
  if (listed.error) return { planName, addedBy: {} };
  const newest = new Map<string, { id: string; code: string; name: string; plan_type: string | null; sort_order: number }>();
  for (const p of rows<{ id: string; code: string; name: string; plan_type: string | null; sort_order: number }>(listed.data)) if (!newest.has(p.code)) newest.set(p.code, p);
  const offered = [...newest.values()].filter((p) => p.code !== currentCode && (!planType || p.plan_type === planType)).sort((a, b) => a.sort_order - b.sort_order);
  if (!offered.length) return { planName, addedBy: {} };
  const access = await client.from("plan_product_access").select("plan_id, product_code").in("plan_id", offered.map((p) => p.id));
  if (access.error) return { planName, addedBy: {} };
  const byPlan = new Map<string, Set<string>>();
  for (const row of rows<{ plan_id: string; product_code: string }>(access.data)) byPlan.set(row.plan_id, (byPlan.get(row.plan_id) ?? new Set()).add(row.product_code));
  const addedBy: Record<string, string[]> = {};
  const catalogue = await client.from("products").select("code").eq("is_active", true);
  for (const { code } of rows<{ code: string }>(catalogue.data)) {
    // A plan that names no products does not narrow (lib/products/agencyProducts.ts), so it adds every one.
    const names = offered.filter((p) => !byPlan.has(p.id) || byPlan.get(p.id)!.has(code)).map((p) => p.name);
    if (names.length) addedBy[code] = names;
  }
  return { planName, addedBy };
}

export async function productReadiness(tenantId: string): Promise<ReadinessPayload> {
  const client = db();
  const carriersOn = [...await carrierIdsOn(tenantId).catch(() => new Set<string>())];
  const [forms, templates, offers, carrierNames, plans] = await Promise.all([
    client.from("tenant_templates").select("product_code, name, applied_at").eq("tenant_id", tenantId),
    client.from("sales_templates").select("tenant_id, kind, product_code, carrier_id, name, version, definition").in("kind", ["underwriting", "quotation"]).eq("status", "published").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
    carriersOn.length
      ? client.from("carrier_products").select("carrier_id, product_code").in("carrier_id", carriersOn).eq("is_active", true).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      : Promise.resolve({ data: [], error: null }),
    carriersOn.length ? client.from("carriers").select("id, name").in("id", carriersOn) : Promise.resolve({ data: [], error: null }),
    plansAdding(tenantId).catch(() => ({ planName: null, addedBy: {} })),
  ]);
  for (const result of [forms, offers, carrierNames]) if (result.error && !isMissingSchema(result.error)) throw new Error(`Could not check what products need: ${result.error.message}`);
  const templateRows = templates.error ? [] : rows<TemplateRow>(templates.data);

  const formBy = new Map<string, { name: string; appliedAt: string | null }>();
  for (const f of rows<{ product_code: string; name: string; applied_at: string | null }>(forms.data)) {
    const seen = formBy.get(f.product_code);
    if (!seen || (f.applied_at ?? "") > (seen.appliedAt ?? "")) formBy.set(f.product_code, { name: f.name, appliedAt: f.applied_at });
  }
  const nameOf = new Map(rows<{ id: string; name: string }>(carrierNames.data).map((c) => [c.id, c.name]));
  const carriersBy = new Map<string, Set<string>>();
  for (const o of rows<{ carrier_id: string; product_code: string | null }>(offers.data)) {
    if (!o.product_code) continue;
    carriersBy.set(o.product_code, (carriersBy.get(o.product_code) ?? new Set()).add(o.carrier_id));
  }
  const codes = new Set([...formBy.keys(), ...carriersBy.keys(), ...templateRows.map((t) => t.product_code)]);
  const products: ProductFacts[] = [...codes].map((code) => {
    const health = bestFor(templateRows, "underwriting", code);
    const quote = bestFor(templateRows, "quotation", code);
    return {
      code,
      form: formBy.get(code) ?? null,
      carriers: [...(carriersBy.get(code) ?? [])].map((id) => nameOf.get(id) ?? "A carrier").sort((a, b) => a.localeCompare(b)),
      health: health ? { name: health.name, questions: health.definition?.fields?.length ?? 0, knockouts: knockouts(health.definition), own: Boolean(health.tenant_id) } : null,
      quote: quote ? { name: quote.name, own: Boolean(quote.tenant_id) } : null,
    };
  });
  return { products, planName: plans.planName, addedBy: plans.addedBy };
}
