// `?preview=sample` only: the design fixtures (lib/applications/settingsFixtures.ts) in the shape the
// Settings › Sales templates route sends, so the sample preview and the live panel render one way.

import type { StoredDefinition } from "@/lib/applications/templates";
import { FIELD_SETS, QUOTATION_TEMPLATES, SALES_CARRIERS, UNDERWRITING_TEMPLATES } from "@/lib/applications/settingsFixtures";
import { definitionFromInterviewQuestions, withQuoteInputs } from "@/lib/salesSettings/templateDefinition";
import type { SalesTemplateKind } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView, TemplatesPayload } from "@/lib/salesSettings/views";

const created = new Date(Date.now() - 20 * 86_400_000).toISOString();
const carrierId = (name: string | null) => (name ? SALES_CARRIERS.find((c) => c.name === name)?.id ?? `car-${name}` : null);

function row(p: Partial<TemplateRowView> & Pick<TemplateRowView, "id" | "kind" | "name" | "version" | "status" | "definition">): TemplateRowView {
  return {
    tenantOwned: true, productCode: "final_expense", productName: "Final Expense", carrierId: null, carrierName: null, publishedAt: p.status === "draft" ? null : created,
    createdAt: created, updatedAt: created, editedBy: "Ray Mason", ...p,
  };
}

function templates(kind: SalesTemplateKind): TemplateRowView[] {
  if (kind === "underwriting") {
    return UNDERWRITING_TEMPLATES.map((t) => row({
      id: t.id, kind, name: t.name, version: t.version, status: t.status, carrierName: t.carrierName, carrierId: carrierId(t.carrierName),
      tenantOwned: t.id !== "ut-general", definition: definitionFromInterviewQuestions(t.questions),
    }));
  }
  if (kind === "quotation") {
    return QUOTATION_TEMPLATES.map((t) => {
      const on = t.fields.map((f) => f.key);
      return row({
        id: t.id, kind, name: `${t.carrierName ?? "Final Expense"} — quotation`, version: t.version, status: t.status, carrierName: t.carrierName, carrierId: carrierId(t.carrierName),
        tenantOwned: t.carrierName !== null, definition: withQuoteInputs(null, on, t.ageBasis, 30) as StoredDefinition,
      });
    });
  }
  return FIELD_SETS.filter((s) => s.entries).map((s) => row({
    id: s.id, kind, name: `${s.carrierName ?? "Platform"} · ${s.productLabel}`, version: 1, status: "published", carrierName: s.carrierName, carrierId: carrierId(s.carrierName),
    tenantOwned: !s.platform,
    definition: { required: (s.entries ?? []).filter((e) => e.required).map((e) => e.key), optional: (s.entries ?? []).filter((e) => !e.required).map((e) => e.key) } as StoredDefinition,
  }));
}

export function sampleTemplates(kind: SalesTemplateKind): TemplatesPayload {
  return {
    templates: templates(kind),
    carriers: SALES_CARRIERS.map((c) => ({ id: c.id, name: c.name })),
    carrierProducts: SALES_CARRIERS.flatMap((c) => c.products.map((p) => ({ carrierId: c.id, productCode: "final_expense", name: p.name }))),
    productLines: [{ code: "final_expense", name: "Final Expense" }, { code: "term_life", name: "Term Life" }],
    canEdit: true,
  };
}
