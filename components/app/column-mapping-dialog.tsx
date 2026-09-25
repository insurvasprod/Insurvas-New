"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Callout, Pill, btn, st, type PillTone } from "@/components/app/settings/primitives";
import { isImportDateField, slashDateReadings, type ImportDateOrder, type ImportDateScan } from "@/lib/agentTemplates/csv";
import type { TemplateFieldType } from "@/lib/templates/constants";
import { cn } from "@/lib/utils";

/**
 * Step 2 of a list import: which of the file's columns is which lead field.
 *
 * A dialog over /app/import rather than a table in the page, so the page underneath keeps its
 * attribution and totals while the one decision that has to be right — which column is the phone
 * number, and how the dates are written — has the screen to itself. Every piece of state lives in
 * the workspace: closing it keeps every choice, and "Map columns" on the page brings it back.
 */

export type MappingField = { key: string; label: string; type: TemplateFieldType; required: boolean };

export type MappingRow = {
  /** Normalised header, as the parser keys it. */
  header: string;
  firstValue: string;
  mapped: string | null;
  /** Where `mapped` came from. */
  source: "suggested" | "saved" | "user";
  confidence: "exact" | "alias" | "fuzzy" | "unmapped";
  /** A `stage` column: never mapped to a field, it picks each lead's starting stage. */
  isStage: boolean;
};

type RowStatus = { tone: PillTone; label: string; detail: string; needsDecision: boolean };

const CONFIDENCE_DETAIL: Record<MappingRow["confidence"], string> = { exact: "Exact", alias: "Alias", fuzzy: "Fuzzy", unmapped: "No match" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "1961-05-06" → "6 May 1961". */
function spokenDate(iso: string | null) {
  if (!iso) return "not a date";
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Everything the dialog and the page's summary button both need to know about a mapping: each
 * row's status, the counts in the pill row, and the one reason Continue cannot be pressed.
 */
export function columnMappingStatus(input: { rows: MappingRow[]; fields: MappingField[]; dates: ImportDateScan; dateOrder: ImportDateOrder; datePicked: boolean }) {
  const fieldByKey = new Map(input.fields.map((field) => [field.key, field]));
  const targets = new Map<string, number>();
  for (const row of input.rows) if (row.mapped) targets.set(row.mapped, (targets.get(row.mapped) ?? 0) + 1);
  const duplicates = [...targets].filter(([, count]) => count > 1).map(([key]) => key);
  const datesPending = input.dates.ambiguous > 0 && !input.datePicked;

  const statuses = new Map<string, RowStatus>();
  for (const row of input.rows) {
    const field = row.mapped ? fieldByKey.get(row.mapped) : undefined;
    const detail = row.source === "user" ? "Your choice" : row.source === "saved" ? "Saved" : CONFIDENCE_DETAIL[row.confidence];
    let status: RowStatus;
    if (row.isStage) status = { tone: "success", label: "Matched", detail: "Picks each lead's starting stage", needsDecision: false };
    else if (!field) status = { tone: "neutral", label: "Ignored", detail: "Not imported", needsDecision: false };
    else if (duplicates.includes(field.key)) status = { tone: "error", label: "Mapped twice", detail: `Another column also maps to ${field.label}`, needsDecision: true };
    else if (isImportDateField({ field_key: field.key, type: field.type }) && (input.dates.ambiguousByHeader[row.header] ?? 0) > 0)
      // A question until the order is picked; once it is, the pill states the answer.
      status = {
        tone: datesPending ? "warning" : "success",
        label: datesPending
          ? input.dateOrder === "dmy" ? "Day-first?" : "US month-first?"
          : input.dateOrder === "dmy" ? "Day first" : "US month first",
        detail: `${detail} · ${input.dates.ambiguousByHeader[row.header].toLocaleString()} dates in this column can be read either way`,
        needsDecision: datesPending,
      };
    else if (row.source === "suggested" && row.confidence === "fuzzy") status = { tone: "warning", label: "Check this", detail: "Fuzzy — the header only resembles the field name", needsDecision: true };
    else status = { tone: "success", label: "Matched", detail, needsDecision: false };
    statuses.set(row.header, status);
  }

  const mappedKeys = new Set(targets.keys());
  const missingRequired = input.fields.filter((field) => field.required && !mappedKeys.has(field.key));
  const mapped = input.rows.filter((row) => row.isStage || (row.mapped && fieldByKey.has(row.mapped))).length;
  const ignored = input.rows.length - mapped;
  const needsDecision = [...statuses.values()].filter((status) => status.needsDecision).length + missingRequired.length;

  const duplicateLabel = duplicates.map((key) => fieldByKey.get(key)?.label ?? key)[0];
  const blockedReason =
    missingRequired.length ? `Map a column to ${missingRequired.map((field) => field.label).join(", ")}.`
      : duplicateLabel ? `Two columns map to ${duplicateLabel}. Choose one.`
        : datesPending ? "Pick a date format."
          : null;

  return { statuses, missingRequired, mapped, ignored, needsDecision, blockedReason };
}

const cellSelect =
  "h-8 w-full min-w-0 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

export function ColumnMappingDialog({
  open,
  onClose,
  onBack,
  onContinue,
  fileName,
  rowCount,
  columnCount,
  rows,
  fields,
  onMap,
  vendorName,
  hasSavedMap,
  savedDateOrder,
  dates,
  dateOrder,
  datePicked,
  onPickDateOrder,
  continueNote,
  busy,
}: {
  open: boolean;
  /** X, Escape or the backdrop. Every choice is kept. */
  onClose: () => void;
  /** Back to the upload step, keeping the file. */
  onBack: () => void;
  onContinue: () => void;
  fileName: string;
  rowCount: number;
  columnCount: number;
  rows: MappingRow[];
  fields: MappingField[];
  onMap: (header: string, fieldKey: string | null) => void;
  vendorName: string | null;
  hasSavedMap: boolean;
  savedDateOrder: ImportDateOrder | null;
  dates: ImportDateScan;
  dateOrder: ImportDateOrder;
  /** Picked on this dialog, or carried by the vendor's saved map. */
  datePicked: boolean;
  onPickDateOrder: (order: ImportDateOrder) => void;
  /** Something the page still needs before the scrub can run, said before Continue is pressed. */
  continueNote: string | null;
  busy: boolean;
}) {
  const status = columnMappingStatus({ rows, fields, dates, dateOrder, datePicked });
  const saveNote = !vendorName
    ? "Choose a vendor to save this map for next time"
    : hasSavedMap ? `Using ${vendorName}’s saved map` : `Saved as ${vendorName}’s map when you continue`;
  const ambiguous = dates.firstAmbiguous;
  const readings = ambiguous ? slashDateReadings(ambiguous) : null;
  const usingSavedDates = Boolean(savedDateOrder && vendorName && savedDateOrder === dateOrder);
  const blocked = status.blockedReason;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(10,12,16,0.55)] px-4 pt-[84px] max-sm:pt-4">
          <DialogPrimitive.Content
            aria-describedby="column-mapping-sub"
            className="m-swap flex max-h-[calc(100dvh-108px)] w-full max-w-[900px] min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_24px_64px_rgba(0,0,0,0.28)] outline-none max-sm:max-h-[calc(100dvh-32px)]"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px]">
              <div className="min-w-0">
                <DialogPrimitive.Title className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Map the columns</DialogPrimitive.Title>
                <DialogPrimitive.Description id="column-mapping-sub" className="mt-[5px] mb-0 truncate text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)] tabular-nums">
                  {fileName} · {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"} · {columnCount.toLocaleString()} column{columnCount === 1 ? "" : "s"}
                </DialogPrimitive.Description>
              </div>
              <div className="flex shrink-0 items-center gap-3.5">
                <span className="text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--accent-ink)]">Step 2 of 4</span>
                <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-[30px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--muted)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                  <X className="size-[13px]" aria-hidden />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
              <div className="flex flex-wrap items-center gap-3" role="status">
                <Pill tone="success" dot>{status.mapped.toLocaleString()} mapped</Pill>
                {status.needsDecision > 0 && <Pill tone="warning" dot>{status.needsDecision.toLocaleString()} {status.needsDecision === 1 ? "needs" : "need"} a decision</Pill>}
                <Pill>{status.ignored.toLocaleString()} ignored</Pill>
                <span className="flex-1" />
                <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{saveNote}</span>
              </div>

              <div className="min-w-0 shrink-0 overflow-x-auto">
                <table className={cn(st.table, "min-w-[760px] table-fixed")}>
                  <thead>
                    <tr className={st.headRow}>
                      <th scope="col" className={cn(st.th, "w-[200px]")}>Their column</th>
                      <th scope="col" className={cn(st.th, "w-[230px]")}>First value</th>
                      <th scope="col" className={cn(st.th, "w-[250px]")}>Maps to</th>
                      <th scope="col" className={st.th}><span className="sr-only">Status</span></th>
                    </tr>
                  </thead>
                  <tbody className="m-seq">
                    {rows.map((row) => {
                      const rowStatus = status.statuses.get(row.header);
                      return <tr key={row.header} className="m-row">
                        <td className={st.td}><code className={cn(st.code, "block truncate")} title={row.header}>{row.header}</code></td>
                        <td className={st.td}><span className="block truncate" title={row.firstValue}>{row.firstValue || "—"}</span></td>
                        <td className={st.td}>
                          {row.isStage
                            ? <span className="block truncate text-[var(--body)]">Starting stage</span>
                            : <select aria-label={`Map ${row.header}`} className={cellSelect} value={row.mapped ?? ""} onChange={(event) => onMap(row.header, event.target.value || null)}>
                                <option value="">— not mapped</option>
                                {fields.map((field) => <option key={field.key} value={field.key}>{field.label}{field.required ? " (required)" : ""}</option>)}
                              </select>}
                        </td>
                        <td className={st.td}>
                          {rowStatus && <span className="flex min-w-0 flex-col items-start" title={rowStatus.detail}>
                            <Pill tone={rowStatus.tone}>{rowStatus.label}</Pill>
                            <span className="mt-0.5 block max-w-full truncate text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{rowStatus.detail}</span>
                          </span>}
                        </td>
                      </tr>;
                    })}
                    {status.missingRequired.map((field) => <tr key={`missing-${field.key}`} className="m-row">
                      <td className={st.td}><span className="text-[var(--muted)]">No column</span></td>
                      <td className={st.td}>—</td>
                      <td className={st.td}>{field.label}</td>
                      <td className={st.td}>
                        <span className="flex min-w-0 flex-col items-start">
                          <Pill tone="error">Required — not mapped</Pill>
                          <span className="mt-0.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Pick the column that holds it above</span>
                        </span>
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>

              {dates.ambiguous > 0 && ambiguous && readings && <Callout
                tone="warning"
                title={dates.firstUnambiguous ? `${dates.firstUnambiguous} is unambiguous. ${ambiguous} is not.` : `${ambiguous} can be read two ways`}
              >
                <p className="m-0">This file has {dates.ambiguous.toLocaleString()} date{dates.ambiguous === 1 ? "" : "s"} where both readings are valid. Pick the format once and it applies to the whole file. The preview updates when you continue.</p>
                <fieldset className="m-0 mt-3 flex min-w-0 flex-wrap gap-3 border-0 p-0">
                  <legend className="sr-only">Date format</legend>
                  {([["mdy", "Month first (US)", readings.mdy], ["dmy", "Day first", readings.dmy]] as const).map(([order, label, reading]) => {
                    const checked = datePicked && dateOrder === order;
                    return <label key={order} htmlFor={`date-order-${order}`} className={cn("flex min-w-[220px] flex-1 cursor-pointer items-start gap-2.5 rounded-[8px] border bg-[var(--surface)] px-3 py-2.5", checked ? "border-[var(--primary)]" : "border-[var(--border-strong)]")}>
                      <input id={`date-order-${order}`} type="radio" name="date-order" className="mt-1 accent-[var(--primary)]" checked={checked} onChange={() => onPickDateOrder(order)} />
                      <span className="min-w-0">
                        <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{label}</span>
                        <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{ambiguous} = {spokenDate(reading)}</span>
                      </span>
                    </label>;
                  })}
                </fieldset>
                {usingSavedDates && <p className="m-0 mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Using {vendorName}&rsquo;s saved date format</p>}
              </Callout>}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5">
              <span className="max-w-[380px] text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                Nothing is imported until step 4, and the leads land in one transaction — all of them or none.
                {(blocked || continueNote) && <span id="column-mapping-continue-note" className={cn("mt-1 block font-semibold", blocked ? "text-[var(--warning-ink)]" : "text-[var(--body)]")}>{blocked ?? continueNote}</span>}
              </span>
              <span className="flex gap-2.5">
                <button type="button" className={btn("secondary", "h-10")} onClick={onBack}>Back</button>
                <button type="button" className={btn("primary", "h-10")} disabled={Boolean(blocked) || busy} aria-describedby={blocked || continueNote ? "column-mapping-continue-note" : undefined} onClick={onContinue}>
                  {busy ? "Checking…" : "Continue to scrub"}
                </button>
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
