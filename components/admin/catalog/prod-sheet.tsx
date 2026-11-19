"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { PRODUCT_CATEGORY_LABELS, type ProductRow } from "@/lib/products/constants";
import { recordDate } from "@/lib/tenants/recordFormat";

export type ProductTemplateRef = { id: string; name: string; active: boolean };
export type ProductPartnerRef = { id: string; name: string };
export type ProductCarrierRef = { code: string; name: string; active: boolean; via: ("sells" | "field map")[] };
export type ProductUsage = { templates: ProductTemplateRef[]; partners: ProductPartnerRef[]; carriers: ProductCarrierRef[] };
export type ProductPart = "details" | "templates" | "partners" | "carriers";

export const PRODUCT_PARTS: readonly ProductPart[] = ["details", "templates", "partners", "carriers"];

const ROW = "flex min-w-0 items-center gap-3 border-b border-border py-2.5 text-sm last:border-b-0";

/**
 * One product as a right sheet (admin round 1, catalog.html screen 5): Details, and the rows behind its counts —
 * the templates built on it (each opens in Templates), the partners approved for it, and the carriers that sell it
 * or have a field map for it (each opens its carrier record). Edit, Archive and Restore are in the footer, through
 * the same routes as before.
 */
export function ProdSheet({ product, usage, carriersRead, part, onPart, onClose, onEdit, onArchive, pending }: {
  product: ProductRow;
  usage: ProductUsage;
  carriersRead: boolean;
  part: ProductPart;
  onPart: (part: ProductPart) => void;
  onClose: () => void;
  onEdit: () => void;
  onArchive: (archived: boolean) => void;
  pending: boolean;
}) {
  const sections = (
    <UnderlineTabs
      label={`${product.name} sections`}
      className="sticky top-0 z-10 bg-card"
      value={part}
      onChange={onPart}
      tabs={[
        { key: "details", label: "Details" },
        { key: "templates", label: "Templates", count: usage.templates.length },
        { key: "partners", label: "Partners", count: usage.partners.length },
        { key: "carriers", label: "Carriers", count: carriersRead ? usage.carriers.length : null },
      ]}
    />
  );

  return (
    <Sheet
      title={product.name}
      subtitle={`${PRODUCT_CATEGORY_LABELS[product.category]} · ${product.code}`}
      status={product.is_active ? <StatusChip tone="good" dot>Active</StatusChip> : <StatusChip tone="neutral">Archived</StatusChip>}
      onClose={onClose}
      bodyClassName="flex flex-col gap-4 px-4 pb-4"
      footer={<>
        {product.is_active
          ? <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={pending} onClick={() => onArchive(true)}>Archive</Button>
          : <Button type="button" variant="outline" disabled={pending} onClick={() => onArchive(false)}>Restore</Button>}
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        <Button type="button" onClick={onEdit}>Edit</Button>
      </>}
    >
      {sections}

      {part === "details" && (
        <FactTable
          rows={[
            ["Name", product.name],
            ["Code", <code key="code" className="font-mono text-xs">{product.code}</code>],
            ["Category", PRODUCT_CATEGORY_LABELS[product.category]],
            ["Description", product.description || "None"],
            ["Sort order", String(product.sort_order)],
            ["Templates", String(usage.templates.length)],
            ["Partners approved", String(usage.partners.length)],
            ["Carriers", carriersRead ? String(usage.carriers.length) : "Could not be read"],
            ["Created", recordDate(product.created_at)],
            ["Updated", recordDate(product.updated_at)],
          ]}
        />
      )}

      {part === "templates" && (
        usage.templates.length === 0 ? (
          <EmptyState title="No template uses this product" hint="A template is the workspace an agency picks for a product. Make one in Templates." action={<Button asChild variant="outline" size="sm"><Link href="/admin/templates?new=1">New template</Link></Button>} />
        ) : (
          <ul className="m-0 list-none p-0" aria-label={`Templates for ${product.name}`}>
            {usage.templates.map((t) => (
              <li key={t.id} className={ROW}>
                <Link href={`/admin/templates?template=${t.id}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">{t.name}</Link>
                <StatusChip tone={t.active ? "good" : "neutral"}>{t.active ? "Offered" : "Not offered"}</StatusChip>
              </li>
            ))}
            <li className="pt-2 text-xs"><Link href={`/admin/templates?product=${encodeURIComponent(product.code)}`} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Open in Templates, filtered to {product.name}</Link></li>
          </ul>
        )
      )}

      {part === "partners" && (
        usage.partners.length === 0 ? (
          <EmptyState title="No partner is approved for it" hint="An agency approves its partners for a product from its own Partners page." />
        ) : (
          <ul className="m-0 list-none p-0" aria-label={`Partners approved for ${product.name}`}>
            {usage.partners.map((p) => (
              <li key={p.id} className={ROW}><span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.name}</span><StatusChip tone="good">Approved</StatusChip></li>
            ))}
          </ul>
        )
      )}

      {part === "carriers" && (
        !carriersRead ? (
          <EmptyState title="The carriers could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
        ) : usage.carriers.length === 0 ? (
          <EmptyState title="No carrier sells it yet" hint="A carrier sells a product once it has a platform carrier product or a field map for it." />
        ) : (
          <ul className="m-0 list-none p-0" aria-label={`Carriers for ${product.name}`}>
            {usage.carriers.map((c) => (
              <li key={c.code} className={ROW}>
                <Link href={`/admin/carriers/${encodeURIComponent(c.code)}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">{c.name}</Link>
                <span className="shrink-0 text-xs text-muted-foreground">{c.via.map((v) => (v === "sells" ? "Sells it" : "Field map")).join(" · ")}</span>
                {!c.active && <StatusChip tone="neutral">Inactive</StatusChip>}
              </li>
            ))}
          </ul>
        )
      )}
    </Sheet>
  );
}
