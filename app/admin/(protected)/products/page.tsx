import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { ProductsTable, type ProductUsage } from "@/components/admin/products-table";
import { fetchProducts } from "@/lib/products/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> } };

export default async function ProductsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "products")) redirect("/admin");

  const db = getSupabaseServiceClient() as unknown as Loose;
  const [products, templates, approvalsWithStatus] = await Promise.all([
    fetchProducts(),
    db.from("templates").select("product_code"),
    db.from("partner_products").select("product_code, partner_id, status"),
  ]);
  // partner_products gained `status` after the generated types were written; where it is absent,
  // every row is an approval (the original table held approvals only).
  const approvals = approvalsWithStatus.error ? await db.from("partner_products").select("product_code, partner_id") : approvalsWithStatus;

  const usage: Record<string, ProductUsage> = {};
  const bump = (code: unknown, key: keyof ProductUsage) => {
    if (typeof code !== "string") return;
    usage[code] ??= { templates: 0, partners: 0 };
    usage[code][key] += 1;
  };
  for (const row of templates.data ?? []) bump(row.product_code, "templates");
  const approvedRows = (approvals.data ?? []).filter((row) => row.status === undefined || row.status === null || row.status === "approved");
  for (const row of approvedRows) bump(row.product_code, "partners");
  const partnerCount = new Set(approvedRows.map((row) => row.partner_id)).size;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <ProductsTable products={products} usage={usage} partnerCount={partnerCount} />
    </div>
  );
}
