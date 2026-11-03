"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Monitor, PanelRightClose, PanelRightOpen, Play, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cardHead, cardSurface } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { PartnerField } from "@/components/partner/partner-portal-workspace";
import type { Picked } from "@/components/app/form-templates/form-canvas";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";
import { placementWidth } from "@/lib/templates/placementWidth";

type Width = "computer" | "phone";
const noop = () => {};

/**
 * Form setup, right: what partners get, drawn with the partner portal's own field renderer as a sheet
 * on a quiet canvas. Every part is open. Clicking a question opens it in the editor (owner 2026-11-03).
 * It starts folded to a slim bar, so the questions have the room; the icon opens it. Computer, Phone and
 * Try the form are icons.
 */
export function FormPreview({ form, fields, productName, picked, open, onToggle, onPick, onTry }: {
  form: TemplateFormDefinition;
  fields: TemplateField[];
  productName: string;
  picked: Picked;
  open: boolean;
  onToggle: () => void;
  onPick: (fieldKey: string, sectionKey: string) => void;
  onTry: () => void;
}) {
  const [width, setWidth] = useState<Width>("computer");
  // On a phone the preview is what a partner on a phone gets: one column (the switch is hidden there).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const twoColumns = width === "computer" && !narrow;
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));

  if (!open) {
    return (
      <section aria-label="Preview, folded" className={cn(cardSurface, "flex min-w-0 flex-row items-center gap-2 px-3 py-2 lg:h-full lg:min-h-0 lg:w-12 lg:flex-col lg:px-0 lg:py-3")}>
        <Button type="button" variant="ghost" size="icon" aria-label="Show what partners see" title="Show what partners see" aria-expanded={false} onClick={onToggle}><PanelRightOpen aria-hidden="true" /></Button>
        <span className="text-xs font-semibold text-[var(--muted)] lg:[writing-mode:vertical-rl]">Preview</span>
      </section>
    );
  }

  const iconButton = (label: string, active: boolean, onClick: () => void, icon: ReactNode) => (
    <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={cn(active && "bg-[var(--primary-soft)] text-[var(--accent-ink)] hover:bg-[var(--primary-soft)]")}>{icon}</Button>
  );

  return (
    <section aria-label="What partners see" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col lg:h-full")}>
      <div className={cn(cardHead, "flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3")}>
        <span className="text-xs font-semibold text-[var(--ink)]">Preview</span>
        <InfoTip label="About this preview">Drawn from your changes, as partners will get it once you publish. Nothing typed here is saved.</InfoTip>
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden sm:contents">
            {iconButton("Show it on a computer", width === "computer", () => setWidth("computer"), <Monitor aria-hidden="true" />)}
            {iconButton("Show it on a phone", width === "phone", () => setWidth("phone"), <Smartphone aria-hidden="true" />)}
          </span>
          <Button onClick={onTry} type="button" variant="ghost" size="icon" aria-label="Try the form" title="Try the form: fill it in as a partner would"><Play aria-hidden="true" /></Button>
          <Button onClick={onToggle} type="button" variant="ghost" size="icon" aria-label="Fold the preview" title="Fold the preview" aria-expanded><PanelRightClose aria-hidden="true" /></Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[color-mix(in_srgb,var(--canvas)_60%,transparent)] p-3 sm:p-5">
        <div className={cn("mx-auto flex w-full flex-col gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 transition-[max-width] duration-200 sm:p-4", width === "phone" ? "max-w-[390px]" : "max-w-[760px]")}>
          <p className="m-0 text-base font-semibold text-[var(--ink)]">Send us a {productName} lead</p>

          {form.sections.map((section, index) => (
            <section key={section.section_key} aria-label={`Part ${index + 1}: ${section.label}`} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 first-of-type:border-t-0 first-of-type:pt-0">
              <span className="text-sm font-semibold text-[var(--ink)]">{section.label || `Part ${index + 1}`}</span>
              <div className={cn("grid gap-x-3 gap-y-0", twoColumns ? "grid-cols-2" : "grid-cols-1")}>
                {section.fields.map((formField) => {
                  const field = fieldMap.get(formField.field_key);
                  if (!field) return null;
                  const isPicked = picked?.fieldKey === field.field_key && picked.sectionKey === section.section_key;
                  const full = placementWidth(field, formField) === "full";
                  const required = field.is_required || formField.is_required;
                  return (
                    <div key={field.field_key} className={cn("relative min-w-0 rounded-[10px] px-2 py-1 transition-colors", twoColumns && full && "col-span-2", isPicked ? "bg-[var(--primary-soft)] outline-2 outline-[var(--ink)]" : "hover:bg-[var(--surface-alt)]")}>
                      <button
                        onClick={() => onPick(field.field_key, section.section_key)}
                        type="button"
                        aria-label={`Change “${field.label}”`}
                        className="absolute inset-0 z-0 cursor-pointer rounded-[10px] border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      />
                      <div className="pointer-events-none relative flex flex-col gap-1">
                        <span className="text-sm font-semibold text-[var(--ink)]">
                          {field.label || "Untitled question"}
                          {required && <span className="text-[var(--error-ink)]" aria-label="must answer"> *</span>}
                        </span>
                        <div inert aria-hidden="true"><PartnerField field={field} value={undefined} onChange={noop} /></div>
                        {field.help_text && <p className="m-0 truncate text-xs text-[var(--body)]">{field.help_text}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-xs text-[var(--body)]">Partners press this to send. It’s off while you edit.</span>
            <Button type="button" disabled>Send lead</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
