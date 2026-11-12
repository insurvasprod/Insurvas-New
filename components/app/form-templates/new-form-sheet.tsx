"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Field, control } from "@/components/app/settings/primitives";
import { notify } from "@/lib/notify";
import { isPhoneTemplateField, type TemplateField, type TemplateFormDefinition } from "@/lib/templates/constants";
import type { FormListRow } from "@/components/app/form-templates/forms-list";
import { FormStatusLine, NeedsUpdate } from "@/components/app/form-templates/status-line";

type Start = "insurvas" | "copy" | "blank";
const AUDIENCES = [{ key: "partners", label: "Partners" }, { key: "agents", label: "Your agents" }, { key: "public", label: "Anyone with the link" }] as const;

/** Only the questions the product already has: an extra form arranges them, it does not add lead fields. */
function keepKnown(form: TemplateFormDefinition, known: Set<string>): TemplateFormDefinition {
  return { ...form, sections: form.sections.map((section) => ({ ...section, fields: section.fields.filter((placed) => known.has(placed.field_key)) })).filter((section) => section.fields.length > 0) };
}

/**
 * New form (board A1): another form for a product, started from the Insurvas form, a copy of one of
 * the agency's forms, or blank (name, phone and consent, the three every lead needs). Several forms per
 * product need 20261112200000; until then the sheet says so and does not create.
 */
export function NewFormSheet({ forms, available, onClose, onCreated }: { forms: FormListRow[]; available: boolean; onClose: () => void; onCreated: (row: { id: string; product_code: string }) => void }) {
  const products = forms.filter((row) => row.kind === "product");
  const [product, setProduct] = useState(products[0]?.product_code ?? "");
  const [start, setStart] = useState<Start>("insurvas");
  const [copyOf, setCopyOf] = useState(forms[0] ? `${forms[0].kind}:${forms[0].id}` : "");
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<string[]>(["partners", "agents"]);
  const [busy, setBusy] = useState(false);
  const productName = products.find((row) => row.product_code === product)?.product_name ?? "this product";

  async function create() {
    const main = products.find((row) => row.product_code === product);
    if (!main) return;
    setBusy(true);
    try {
      const currentResponse = await fetch(`/api/app/templates?product=${encodeURIComponent(product)}`, { cache: "no-store" });
      const current = await currentResponse.json();
      if (!currentResponse.ok) throw new Error(current?.error ?? "The product’s form didn’t load");
      const fields = current.current.template.fields as TemplateField[];
      const known = new Set(fields.map((field) => field.field_key));
      let form: TemplateFormDefinition;
      if (start === "insurvas") {
        const response = await fetch(`/api/app/templates/default?product=${encodeURIComponent(product)}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Couldn’t read the Insurvas form");
        form = keepKnown(body.form_definition as TemplateFormDefinition, known);
      } else if (start === "copy") {
        const [kind, id] = copyOf.split(":");
        if (kind === "variant") {
          const response = await fetch(`/api/app/templates/variants/${id}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok) throw new Error(body?.error ?? "Couldn’t read that form");
          form = keepKnown(body.variant.form_definition as TemplateFormDefinition, known);
        } else {
          const source = forms.find((row) => row.kind === "product" && row.id === id);
          const response = await fetch(`/api/app/templates?product=${encodeURIComponent(source?.product_code ?? product)}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok) throw new Error(body?.error ?? "Couldn’t read that form");
          form = keepKnown(body.current.template.form_definition as TemplateFormDefinition, known);
        }
      } else {
        const basics = fields.filter((field) => isPhoneTemplateField(field) || /^(first_name|last_name|full_name|consent\w*)$/.test(field.field_key));
        form = { sections: [{ section_key: "contact", label: "Contact", sort_order: 0, fields: basics.map((field) => ({ field_key: field.field_key, is_required: true, show_when: null })) }] };
      }
      if (!form.sections.length) form = { sections: [{ section_key: "contact", label: "Contact", sort_order: 0, fields: [] }] };
      const response = await fetch("/api/app/templates/forms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_template_id: main.tenant_template_id, name: name.trim() || `${productName} form`, audience, form_definition: form }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Couldn’t make the form");
      notify.done("Form made", { detail: "It opens as a draft. Publish it when it is ready." });
      onCreated({ id: body.variant.id, product_code: product });
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "Couldn’t make the form");
    } finally {
      setBusy(false);
    }
  }

  const option = (key: Start, title: string, hint: string) => (
    <label key={key} className={cn("flex cursor-pointer items-start gap-3 rounded-[10px] border p-3", start === key ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]")}>
      <input type="radio" name="new-form-start" className="mt-1 accent-[var(--primary)]" checked={start === key} onChange={() => setStart(key)} />
      <span className="min-w-0"><strong className="block text-sm font-semibold text-[var(--ink)]">{title}</strong><span className="block text-xs text-[var(--muted)]">{hint}</span></span>
    </label>
  );
  return (
    <Sheet
      title="New form"
      status={available ? undefined : <NeedsUpdate />}
      onClose={onClose}
      footer={<><span className="flex-1" /><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!available || busy || !product || audience.length === 0} onClick={() => void create()}>{busy ? "Making it…" : "Create and open"}</Button></>}
    >
      {!available && <FormStatusLine tone="warning">Several forms per product save once Insurvas applies its database update. Each product’s main form works now.</FormStatusLine>}
      <Field label="Product" htmlFor="new-form-product" hint="A product can have as many forms as you like. Each one makes leads for this product.">
        <select id="new-form-product" className={control} value={product} onChange={(event) => setProduct(event.target.value)}>
          {products.map((row) => <option key={row.product_code} value={row.product_code}>{row.product_name}</option>)}
        </select>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-label text-[var(--body)]">Start from</span>
        {option("insurvas", `The Insurvas ${productName} form`, "Its questions and pages, kept as Insurvas made them until you change them")}
        {option("copy", "A copy of one of your forms", forms.slice(0, 3).map((row) => row.name).join(", ") || "None yet")}
        {start === "copy" && (
          <select aria-label="The form to copy" className={control} value={copyOf} onChange={(event) => setCopyOf(event.target.value)}>
            {forms.map((row) => <option key={`${row.kind}:${row.id}`} value={`${row.kind}:${row.id}`}>{row.name} · {row.product_name}</option>)}
          </select>
        )}
        {option("blank", "A blank form", "Just name, phone and consent, the three every lead needs")}
      </div>
      <Field label="Form name" htmlFor="new-form-name" hint="Partners see this name when they pick a form.">
        <input id="new-form-name" className={control} maxLength={120} placeholder={`${productName} · Spanish`} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-label text-[var(--body)]">Who fills it in</span>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((item) => <ToggleChip key={item.key} selected={audience.includes(item.key)} onClick={() => setAudience((list) => (list.includes(item.key) ? list.filter((value) => value !== item.key) : [...list, item.key]))}>{item.label}</ToggleChip>)}
        </div>
      </div>
    </Sheet>
  );
}
