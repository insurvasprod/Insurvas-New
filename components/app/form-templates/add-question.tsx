"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { control } from "@/components/app/settings/primitives";
import { TEMPLATE_FIELD_TYPES, type TemplateField, type TemplateFieldType } from "@/lib/templates/constants";
import { COMMON_FIELD_TYPES, TEMPLATE_FIELD_PLAIN } from "@/lib/templates/plainLabels";

/**
 * "What should partners answer with?" — opened inside the section it adds to, so the new question
 * lands where it was asked for. Eight plain tiles first, the other kinds behind "More kinds", and a
 * field the agency already has can be reused instead of made again.
 */
export function AddQuestion({ sectionLabel, reusable, onPick, onReuse, onClose }: {
  sectionLabel: string;
  /** Lead fields not in this section yet. */
  reusable: TemplateField[];
  onPick: (type: TemplateFieldType) => void;
  onReuse: (fieldKey: string) => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const rare = TEMPLATE_FIELD_TYPES.filter((type) => !COMMON_FIELD_TYPES.includes(type));
  const tile = (type: TemplateFieldType, index: number) => (
    <button
      key={type}
      onClick={() => onPick(type)}
      ref={index === 0 ? first : undefined}
      type="button"
      className="flex min-h-[52px] flex-col items-start justify-center rounded-[10px] border-0 bg-[var(--surface)] px-3 py-2 text-left transition-colors hover:bg-[var(--primary-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    >
      <span className="text-sm font-semibold text-[var(--ink)]">{TEMPLATE_FIELD_PLAIN[type].label}</span>
      <span className="text-xs text-[var(--muted)]">{TEMPLATE_FIELD_PLAIN[type].hint}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label={`Add a question to ${sectionLabel}`}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      className="flex flex-col gap-3 rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface-alt)] p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">What should partners answer with?</p>
        <Button onClick={onClose} type="button" variant="ghost" size="icon" aria-label="Close without adding"><X aria-hidden="true" /></Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{COMMON_FIELD_TYPES.map(tile)}</div>
      {more ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{rare.map((type, index) => tile(type, index + COMMON_FIELD_TYPES.length))}</div>
      ) : (
        <div>
          <Button onClick={() => setMore(true)} type="button" variant="ghost">More kinds: long text, pick several, Social Security, bank details</Button>
        </div>
      )}
      {reusable.length > 0 && (
        <label className="block text-sm text-[var(--body)]">
          <span className="font-semibold">Or reuse a question you already have</span>
          <select className={control} defaultValue="" onChange={(event) => { if (event.target.value) onReuse(event.target.value); }}>
            <option value="">Choose one…</option>
            {reusable.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
