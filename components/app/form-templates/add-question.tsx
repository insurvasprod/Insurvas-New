"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { Banknote, Calendar, CornerDownLeft, DollarSign, FileText, Hash, Landmark, List, ListChecks, Mail, Phone, ShieldCheck, ToggleLeft, Type, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { inputControl } from "@/components/ui/field";
import type { TemplateField, TemplateFieldType } from "@/lib/templates/constants";

/** What a drag from the library carries (read by the canvas). */
export const LIBRARY_DRAG = "application/x-insurvas-form-field";
export type LibraryItem = { kind: "type"; type: TemplateFieldType } | { kind: "insurvas"; key: string } | { kind: "page" };

export const TYPE_ICON: Record<TemplateFieldType, LucideIcon> = {
  text: Type, long_text: FileText, number: Hash, date: Calendar, currency: DollarSign, phone: Phone, email: Mail,
  ssn: ShieldCheck, bank_routing: Landmark, bank_account: Banknote, boolean: ToggleLeft, single_select: List, multi_select: ListChecks,
};
/** The library's short names (board A2). */
export const TYPE_SHORT: Record<TemplateFieldType, string> = {
  text: "Text", long_text: "Long text", number: "Number", currency: "Money", date: "Date", phone: "Phone", email: "Email",
  boolean: "Yes / no", single_select: "Choice", multi_select: "Multiple", ssn: "SSN", bank_routing: "Bank routing", bank_account: "Bank account",
};
const ORDER: TemplateFieldType[] = ["text", "long_text", "number", "currency", "date", "phone", "email", "boolean", "single_select", "multi_select", "ssn", "bank_routing", "bank_account"];

function Tile({ icon: Icon, label, note, payload, onAdd, disabled }: { icon: LucideIcon; label: string; note?: ReactNode; payload: LibraryItem; onAdd: () => void; disabled?: boolean }) {
  const start = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(LIBRARY_DRAG, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };
  return (
    <button
      type="button"
      draggable={!disabled}
      disabled={disabled}
      onDragStart={start}
      onClick={onAdd}
      title={disabled ? undefined : `Add “${label}” to this page, or drag it where it should go`}
      className={cn(
        "flex min-h-9 w-full min-w-0 cursor-grab items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:border-[var(--border-strong)] active:cursor-grabbing",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="shrink-0 text-xs text-[var(--muted)]">{note}</span>}
    </button>
  );
}

/**
 * "Add a field", the builder's left pane (board A2): the Insurvas questions for this product, ready to
 * use (the ones on the form say "in use"), every kind of answer, and a new page. Click to add to the
 * open page, or drag onto the form where it should go.
 */
export function FieldLibrary({ insurvas, used, onAdd, typesAllowed = true }: {
  /** The Insurvas form's questions for this product; null while they load. */
  insurvas: TemplateField[] | null;
  /** Question keys already on the form. */
  used: ReadonlySet<string>;
  onAdd: (item: LibraryItem) => void;
  /** False on an extra form, which arranges the product's own questions only. */
  typesAllowed?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const standard = (insurvas ?? []).filter((field) => !q || field.label.toLowerCase().includes(q));
  const types = ORDER.filter((type) => !q || TYPE_SHORT[type].toLowerCase().includes(q));
  const heading = "m-0 mt-4 mb-2 text-xs font-semibold text-[var(--muted)] first:mt-0";
  return (
    <div className="flex min-h-0 flex-col">
      <input aria-label="Search fields" className={cn(inputControl, "mb-3 h-8 text-sm")} placeholder="Search fields" value={query} onChange={(event) => setQuery(event.target.value)} />
      <h3 className={heading}>{typesAllowed ? "Insurvas questions · ready to use" : "This product’s questions"}</h3>
      {insurvas === null ? (
        <p className="m-0 text-sm text-[var(--muted)]">Reading the Insurvas questions</p>
      ) : standard.length === 0 ? (
        <p className="m-0 text-sm text-[var(--muted)]">{q ? "None match." : "Insurvas has no questions for this product."}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {standard.map((field) => (
            <Tile key={field.field_key} icon={TYPE_ICON[field.type] ?? Type} label={field.label} note={used.has(field.field_key) ? "in use" : undefined} payload={{ kind: "insurvas", key: field.field_key }} onAdd={() => onAdd({ kind: "insurvas", key: field.field_key })} disabled={used.has(field.field_key)} />
          ))}
        </div>
      )}
      {typesAllowed && (
        <>
          <h3 className={heading}>Field types</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {types.map((type) => <Tile key={type} icon={TYPE_ICON[type]} label={TYPE_SHORT[type]} payload={{ kind: "type", type }} onAdd={() => onAdd({ kind: "type", type })} />)}
          </div>
        </>
      )}
      <h3 className={heading}>Layout</h3>
      <Tile icon={CornerDownLeft} label="New page" payload={{ kind: "page" }} onAdd={() => onAdd({ kind: "page" })} />
    </div>
  );
}
