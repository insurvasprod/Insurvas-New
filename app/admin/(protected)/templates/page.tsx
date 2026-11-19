import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { TmplNewButton } from "@/components/admin/catalog/tmpl-new-button";
import { TemplatesTable, type CatalogTemplate } from "@/components/admin/templates-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { fetchTemplates } from "@/lib/templates/queries";
import { fetchTemplatePublication, fetchTemplateUsage } from "@/lib/templates/usage";
import { templateState } from "@/lib/templates/catalog";
import { fetchProducts } from "@/lib/products/queries";

function count(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Catalog › Templates (admin round 1, docs/design/admin-r1/catalog.html screen 6), inside the Catalog frame: the
 * lead fields, pipeline stages and application form an agency starts from, per product. Same figures, columns,
 * filters and editor as before; the editor opens as a wide right sheet with the agent preview beside it and what
 * changed against the saved version.
 */
export default async function TemplatesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen.
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

  return (
    <CatalogPage
      step="templates"
      info="The starting workspace an agency picks for a product: its lead fields, pipeline stages and application form. Saving creates a new version; agencies on an older one keep theirs."
      actions={<TmplNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Templates at a glance">
          <StatTile label="Templates" value={count(templates.length)} footnote={`across ${count(productsCovered)} ${productsCovered === 1 ? "product" : "products"}`} />
          <StatTile
            label="Published"
            value={count(published)}
            footnote="offered to tenants"
            labelTitle="Active templates: agencies can pick them for a product."
            href="/admin/templates?states=published"
          />
          <StatTile
            label="Drafts"
            value={count(drafts)}
            footnote={archived > 0 ? `not visible to tenants · ${count(archived)} archived` : "not visible to tenants"}
            labelTitle={
              publication.draftsSupported
                ? "Never offered yet. Archived templates were offered once and withdrawn; neither can be picked by an agency."
                : "Drafts need database update 20260925504000. Until it is applied every inactive template counts as archived."
            }
            href="/admin/templates?states=draft,archived"
          />
          <StatTile
            label="In-progress applications"
            value={usage ? count(usage.inProgress) : "—"}
            footnote={usage ? "each on its own version" : "could not be loaded"}
            labelTitle="Saved application drafts on agency copies of these templates. Each is pinned to the copy revision it was started on."
          />
        </StatStrip>

        <TemplatesTable templates={rows} products={products} usage={usage} draftsSupported={publication.draftsSupported} />
      </div>
    </CatalogPage>
  );
}
