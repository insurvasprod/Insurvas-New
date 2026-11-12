"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/view-tabs";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";
import { FormRun } from "@/components/app/form-templates/form-run";
import { FormStatusLine } from "@/components/app/form-templates/status-line";

type Width = "computer" | "phone" | "both";

/**
 * Preview (board A5): over the builder, the draft at both widths side by side. Answers can be typed in
 * either and logic runs live; both share one set of answers. Nothing is saved from the preview.
 * "Open in the partner form" is the partner portal's own form, fed this draft (LA-1.4-5).
 */
export function FormPreview({ fields, form, title, link, onBack, onTest, onPartnerForm }: {
  fields: TemplateField[];
  form: TemplateFormDefinition;
  title: string;
  /** The share link, when the form has one; shown in the computer frame's address bar. */
  link: string | null;
  onBack: () => void;
  onTest: (values: Record<string, unknown>) => void;
  onPartnerForm: () => void;
}) {
  const [width, setWidth] = useState<Width>("both");
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <section aria-label="Preview" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Preview width" value={width} onChange={setWidth} options={[{ key: "computer", label: "Computer" }, { key: "phone", label: "Phone" }, { key: "both", label: "Both" }]} />
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onPartnerForm}>Open in the partner form</Button>
        <Button type="button" variant="outline" onClick={() => setValues({})}>Start again</Button>
        <Button type="button" variant="outline" onClick={onBack}>Back to building</Button>
        <Button type="button" onClick={() => onTest(values)}>Test submission</Button>
      </div>
      <FormStatusLine tone="neutral">Showing your draft · nothing is saved from the preview</FormStatusLine>
      <div className="flex min-h-0 flex-1 flex-wrap items-start justify-center gap-6 overflow-y-auto overscroll-contain rounded-[12px] bg-[var(--surface-alt)] p-4 sm:p-6">
        {width !== "phone" && (
          <div className="m-glass w-full max-w-[720px] min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)]">
            <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--border-strong)]" />
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--border-strong)]" />
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--border-strong)]" />
              <span className="ml-2 truncate">{link ?? "Partner portal · New lead"}</span>
            </div>
            <div className="p-5"><FormRun fields={fields} form={form} title={title} mode="computer" values={values} onValues={setValues} /></div>
          </div>
        )}
        {width !== "computer" && (
          <div className={cn("w-[340px] max-w-full shrink-0 rounded-[28px] border-[6px] border-[var(--border-strong)] bg-[var(--surface)] p-4")}>
            <FormRun fields={fields} form={form} title={title} mode="phone" values={values} onValues={setValues} />
          </div>
        )}
      </div>
    </section>
  );
}
