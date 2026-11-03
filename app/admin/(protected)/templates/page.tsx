import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { TemplatesTable, type CatalogTemplate } from "@/components/admin/templates-table";
import { fetchTemplates } from "@/lib/templates/queries";
import { fetchTemplatePublication, fetchTemplateUsage } from "@/lib/templates/usage";
import { templateState } from "@/lib/templates/catalog";
import { fetchProducts } from "@/lib/products/queries";

function count(value: number) {
  return value.toLocaleString("en-US");
}

export default async function TemplatesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "templates")) redirect("/admin");

  const [templates, products, publication] = await Promise.all([
    fetchTemplates(),
    fetchProducts(),
    // A failed read degrades to "no drafts known" — every inactive template reads Archived, as before.
    fetchTemplatePublication().catch(() => ({ draftsSupported: false, publishedAt: {} as Record<string, string | null> })),
  ]);
  const usage = await fetchTemplateUsage(templates).catch(() => null);

  const rows: CatalogTemplate[] = templates.map((template) => ({
    ...template,
    state: templateState(template.is_active, publication.publishedAt[template.id], publication.draftsSupported),
  }));

  const published = rows.filter((row) => row.state === "published").length;
  const drafts = rows.filter((row) => row.state === "draft").length;
  const archived = rows.filter((row) => row.state === "archived").length;
  const productsCovered = new Set(templates.map((template) => template.product_code)).size;

  const tiles = (
    <BoardStatGrid>
      <BoardStatTile
        label="Templates"
        value={count(templates.length)}
        footnote={`across ${count(productsCovered)} ${productsCovered === 1 ? "product" : "products"}`}
      />
      <BoardStatTile
        label="Published"
        value={count(published)}
        tone={published > 0 ? "success" : "default"}
        footnote="offered to tenants"
        title="Active templates: agencies can pick them for a product."
      />
      <BoardStatTile
        label="Drafts"
        value={count(drafts)}
        tone={drafts > 0 ? "warning" : "default"}
        footnote={archived > 0 ? `not visible to tenants · ${count(archived)} archived` : "not visible to tenants"}
        title={
          publication.draftsSupported
            ? "Never offered yet. Archived templates were offered once and withdrawn; neither can be picked by an agency."
            : "Drafts need database update 20260925504000. Until it is applied every inactive template counts as archived."
        }
      />
      <BoardStatTile
        label="In-progress applications"
        value={usage ? count(usage.inProgress) : "—"}
        footnote={usage ? "each on its own version" : "could not be loaded"}
        title="Saved application drafts on agency copies of these templates. Each is pinned to the copy revision it was started on."
      />
    </BoardStatGrid>
  );

  return (
    <TemplatesTable
      templates={rows}
      products={products}
      tiles={tiles}
      usage={usage}
      draftsSupported={publication.draftsSupported}
    />
  );
}
