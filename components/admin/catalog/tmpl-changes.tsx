"use client";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import type { ProductRow } from "@/lib/products/constants";
import type { TemplateState } from "@/lib/templates/catalog";
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";
import { CHANGE_KIND_LABELS, type FormChange } from "@/lib/templates/formChanges";

type EditorDraft = { name: string; product_code: string; description: string; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition };

const KIND_TONE: Record<FormChange["kind"], StatusTone> = { added: "good", changed: "info", moved: "neutral", removed: "warning" };

/** The editor's draft in the shape the form-change reader takes. */
export function asChangeDraft(draft: EditorDraft): TemplateDraft {
  return { name: draft.name, fields: draft.fields, stages: draft.stages, form: draft.form_definition };
}

/** What the form-change reader does not cover: the product and the description. */
export function detailChanges(saved: EditorDraft, draft: EditorDraft, products: ProductRow[]): FormChange[] {
  const out: FormChange[] = [];
  const name = (code: string) => products.find((p) => p.code === code)?.name ?? code;
  if (saved.product_code !== draft.product_code) out.push({ id: "detail:product", kind: "changed", title: `Product is now ${name(draft.product_code)}`, sub: `Was: ${name(saved.product_code)}` });
  if (saved.description.trim() !== draft.description.trim()) out.push({ id: "detail:description", kind: "changed", title: draft.description.trim() ? "Description changed" : "Description removed", sub: draft.description.trim() || undefined });
  return out;
}

/**
 * "What changed" (admin round 1, catalog.html screen 6): every edit in the sheet against the saved version — the one
 * agencies are offered when the template is published — one plain line each, so Save new version is never a guess.
 */
export function TmplChanges({ changes, version, state }: { changes: FormChange[]; version: number; state?: TemplateState }) {
  const against = state === "published" ? `the published version (v${version})` : `the saved v${version}`;
  return (
    <section className="rounded-lg border border-border p-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-foreground">What changed</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{changes.length ? `${changes.length.toLocaleString("en-US")} ${changes.length === 1 ? "change" : "changes"}` : "None yet"}</span>
      </div>
      {changes.length === 0 ? (
        <p className="m-0 mt-2 text-xs leading-[1.5] text-muted-foreground">Nothing differs from {against}. Edits show here, one line each, before you save.</p>
      ) : (
        <>
          <p className="m-0 mt-1 text-xs text-muted-foreground">Against {against}.</p>
          <ul className="m-0 mt-3 grid list-none gap-2 p-0">
            {changes.map((change) => (
              <li key={change.id} className="flex min-w-0 items-start gap-2 text-sm">
                <StatusChip tone={KIND_TONE[change.kind]} dot={false} className="shrink-0">{CHANGE_KIND_LABELS[change.kind]}</StatusChip>
                <span className="min-w-0">
                  <span className="block break-words text-foreground">{change.title}</span>
                  {change.sub && <span className="block break-words text-xs text-muted-foreground">{change.sub}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
