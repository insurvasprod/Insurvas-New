import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { ProdNewButton } from "@/components/admin/catalog/prod-new-button";
import { ProductsTable, type ProductUsage } from "@/components/admin/products-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/products/constants";
import { fetchProducts } from "@/lib/products/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Read = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Catalog › Products (admin round 1, docs/design/admin-r1/catalog.html screen 5), inside the Catalog frame. The
 * insurance product catalogue every template, partner approval and carrier product points at. Each product's counts
 * now open the rows behind them: its templates, the partners approved for it, and the carriers that sell it or have
 * a field map for it.
 */
export default async function ProductsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen.
  if (!canAccessConfigurationSection(admin.role, "products")) redirect("/admin");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- carrier_products, carrier_field_map and partner_products.status are not all in the generated types
  const db = getSupabaseServiceClient() as any;
  const safe = (read: PromiseLike<Read>) => Promise.resolve(read).catch((): Read => ({ data: null, error: { message: "failed" } }));
  const [products, templates, approvalsWithStatus, carrierProducts, fieldMaps, carriers] = await Promise.all([
    fetchProducts(),
    safe(db.from("templates").select("id, name, product_code, is_active")),
    safe(db.from("partner_products").select("product_code, partner_id, status")),
    safe(db.from("carrier_products").select("id, carrier_id, product_code, is_active").is("tenant_id", null)),
    safe(db.from("carrier_field_map").select("carrier_id, carrier_product_id, status").is("tenant_id", null)),
    safe(db.from("carriers").select("id, code, name, is_active").is("organization_id", null)),
  ]);
  // partner_products gained `status` after the generated types were written; where it is absent,
  // every row is an approval (the original table held approvals only).
  const approvals = approvalsWithStatus.error ? await safe(db.from("partner_products").select("product_code, partner_id")) : approvalsWithStatus;
  const approvedRows = (approvals.data ?? []).filter((row) => row.status === undefined || row.status === null || row.status === "approved");
  const partnerIds = [...new Set(approvedRows.map((row) => String(row.partner_id)))];
  const partners = partnerIds.length ? await safe(db.from("partners").select("id, name").in("id", partnerIds)) : { data: [], error: null };
  const partnerName = new Map((partners.data ?? []).map((p) => [String(p.id), String(p.name ?? "Partner")]));

  const usage: Record<string, ProductUsage> = {};
  const entry = (code: string) => (usage[code] ??= { templates: [], partners: [], carriers: [] });
  for (const row of templates.data ?? []) if (typeof row.product_code === "string") entry(row.product_code).templates.push({ id: String(row.id), name: String(row.name ?? "Template"), active: row.is_active !== false });
  for (const row of approvedRows) if (typeof row.product_code === "string") entry(row.product_code).partners.push({ id: String(row.partner_id), name: partnerName.get(String(row.partner_id)) ?? "Partner" });

  // Carriers: those with a platform carrier product for it (they sell it), and those with a platform field map on one.
  const carrierBy = new Map((carriers.data ?? []).map((c) => [String(c.id), { code: String(c.code), name: String(c.name), active: c.is_active !== false }]));
  const productOfCarrierProduct = new Map((carrierProducts.data ?? []).map((cp) => [String(cp.id), String(cp.product_code)]));
  const via = new Map<string, Map<string, Set<"sells" | "field map">>>();
  const mark = (productCode: string, carrierId: string, how: "sells" | "field map") => {
    const byCarrier = via.get(productCode) ?? new Map<string, Set<"sells" | "field map">>();
    byCarrier.set(carrierId, (byCarrier.get(carrierId) ?? new Set()).add(how));
    via.set(productCode, byCarrier);
  };
  for (const cp of carrierProducts.data ?? []) if (cp.is_active !== false) mark(String(cp.product_code), String(cp.carrier_id), "sells");
  for (const map of fieldMaps.data ?? []) {
    const code = map.carrier_product_id ? productOfCarrierProduct.get(String(map.carrier_product_id)) : undefined;
    if (code && map.status !== "retired") mark(code, String(map.carrier_id), "field map");
  }
  for (const [productCode, byCarrier] of via) {
    for (const [carrierId, how] of byCarrier) {
      const carrier = carrierBy.get(carrierId);
      if (carrier) entry(productCode).carriers.push({ ...carrier, via: [...how] });
    }
  }
  for (const value of Object.values(usage)) value.carriers.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const carriersRead = !carrierProducts.error && !carriers.error;

  const active = products.filter((p) => p.is_active);
  const archived = products.length - active.length;
  const categories = [...new Set(active.map((p) => p.category))];
  const usedByTemplates = active.filter((p) => (usage[p.code]?.templates.length ?? 0) > 0).length;
  const approved = active.filter((p) => (usage[p.code]?.partners.length ?? 0) > 0).length;
  const partnerCount = new Set(approvedRows.map((row) => row.partner_id)).size;

  return (
    <CatalogPage
      step="products"
      info="The insurance products agencies sell. Templates, partner approvals and carrier products all point at a product's code, which is permanent once created."
      actions={<ProdNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {(templates.error || !carriersRead) && (
          <BillingStatusLine
            tone="bad"
            lead={{ text: "Some figures could not be read" }}
            parts={[templates.error ? "the templates could not be read" : null, carriersRead ? null : "the carriers could not be read", "reload the page"]}
          />
        )}

        <StatStrip label="Products at a glance">
          <StatTile label="Products" value={count(active.length)} footnote={archived > 0 ? `${count(archived)} archived` : "none archived"} href={archived > 0 ? "/admin/products?archived=include" : undefined} />
          <StatTile label="Categories" value={count(categories.length)} footnote={categories.map((c) => PRODUCT_CATEGORY_LABELS[c]).join(", ") || "none in use"} />
          <StatTile label="Used by templates" value={count(usedByTemplates)} footnote={`of ${count(active.length)} active`} href="/admin/templates" />
          <StatTile label="Approved for partners" value={count(approved)} footnote={`across ${count(partnerCount)} ${partnerCount === 1 ? "partner" : "partners"}`} />
        </StatStrip>

        <ProductsTable products={products} usage={usage} carriersRead={carriersRead} />
      </div>
    </CatalogPage>
  );
}
