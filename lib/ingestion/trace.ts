/**
 * LA-4.20 (Notion sprint) · traceability: every figure on an LA-4 screen back to the row of the file
 * it came from.
 *
 *   a figure → the policies or ledger lines behind it (each screen's drill-through)
 *            → the snapshot or commission line
 *            → the raw row, every original column, the layout map version and what each became
 *            → the file: carrier, date, type, hash, parser version, source
 *            → the original file, downloadable (a sixty-second link, role-gated, every download logged)
 *
 * TRACE_SCREENS is the registry the build holds every LA-4 screen to: each names the tables its
 * figures come from, and each of those must be covered by the database's trace check
 * (trace_problems, migration 20261008290000). A new screen that reads carrier data and isn't
 * registered fails the build (trace.test.mjs).
 *
 * Pure.
 */

export const fileHref = (fileId: string) => `/app/carrier-files/file/${fileId}`;
export const rowHref = (fileId: string, rowNumber: number) => `/app/carrier-files/file/${fileId}/row/${rowNumber}`;

/** The tables a figure can come from, and the check in trace_problems that covers each. */
export const TRACED_SOURCES = {
  policy_current: "policies",
  commission_entry: "ledger",
  commission_policy_totals: "ledger",
  expected_commission: "rate_card",
  commission_discrepancy: "discrepancies",
} as const;
export type TracedSource = keyof typeof TRACED_SOURCES;

/**
 * Every LA-4 screen that shows a carrier-derived figure or status, and where those come from. A
 * screen built only from the agency's own entries (the earlier "Entered by hand" views) is not here.
 */
export const TRACE_SCREENS: Record<string, { label: string; sources: TracedSource[] }> = {
  "app/app/(shell)/policies/page.tsx": { label: "Policies", sources: ["policy_current"] },
  "app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/page.tsx": { label: "Policy page", sources: ["policy_current", "commission_entry", "expected_commission"] },
  "app/app/(shell)/ledger/page.tsx": { label: "Commission ledger", sources: ["commission_entry"] },
  "app/app/(shell)/rate-card/page.tsx": { label: "Rate card", sources: ["expected_commission"] },
  "app/app/(shell)/discrepancies/page.tsx": { label: "Discrepancies", sources: ["commission_discrepancy", "commission_entry", "expected_commission"] },
  "app/app/(shell)/lapse-risk/page.tsx": { label: "Lapse risk", sources: ["policy_current", "commission_entry"] },
  "app/app/(shell)/book-scorecards/page.tsx": { label: "Book scorecards", sources: ["policy_current", "commission_policy_totals", "commission_entry"] },
  "app/app/(shell)/carrier-files/page.tsx": { label: "Carrier files", sources: ["policy_current"] },
  "app/app/(shell)/carrier-files/file/[fileId]/page.tsx": { label: "Carrier file", sources: ["policy_current", "commission_entry"] },
  "app/app/(shell)/carrier-files/file/[fileId]/row/[rowNumber]/page.tsx": { label: "Raw row", sources: ["policy_current", "commission_entry"] },
  "app/app/(shell)/policy-matching/page.tsx": { label: "Policy matching", sources: ["policy_current"] },
  "app/app/(shell)/exceptions/page.tsx": { label: "Exceptions", sources: ["policy_current", "commission_entry"] },
  "app/app/(shell)/carrier-rules/page.tsx": { label: "Carrier rules", sources: ["policy_current"] },
  "app/app/(shell)/book-import/page.tsx": { label: "Book import", sources: ["policy_current"] },
};

/** A store module that reads carrier-derived figures: a page importing one must be registered above. */
export const CARRIER_DATA_STORES = [
  "policyBookStore", "commissionLedgerStore", "expectedCommissionStore", "discrepancyStore", "carrierAccountsStore", "retentionStore",
  "scorecardsStore", "snapshotStore", "policyMatchingStore", "exceptionQueues", "carrierRulesStore", "bookImport", "traceStore", "registry", "dailyRunStore",
] as const;

// ─── the raw-row view ─────────────────────────────────────────────────────────────────────────

export type RawColumnView = { key: string; header: string; column: string };
export type MapEntryView = { sourceColumn: string; targetField: string; dataType: string | null; transform: string | null; required: boolean };
export type ColumnTrace = { column: string; header: string; value: string; becameField: string | null; dataType: string | null; transform: string | null; required: boolean; stored: string | null };

/**
 * Every original column of a row, in the file's order, with what the layout map made of it and
 * the value that landed (from the snapshot's fields, or the commission line's). A column the map
 * didn't read is kept too: for a policy file it travels in the snapshot's `extra`.
 */
export function columnTrace(columns: RawColumnView[], payload: Record<string, string>, entries: MapEntryView[], stored: Record<string, string | number | null>, extra: Record<string, unknown> | null = null): ColumnTrace[] {
  const byColumn = new Map(entries.map((e) => [e.sourceColumn, e]));
  return columns.map((c) => {
    const entry = byColumn.get(c.header) ?? null;
    const value = payload[c.key] ?? "";
    const landed = entry ? stored[entry.targetField] : extra && c.header in extra ? String(extra[c.header] ?? "") : undefined;
    return {
      column: c.column,
      header: c.header,
      value,
      becameField: entry?.targetField ?? null,
      dataType: entry?.dataType ?? null,
      transform: entry?.transform ?? null,
      required: entry?.required ?? false,
      stored: landed === undefined || landed === null ? null : String(landed),
    };
  });
}

/** The fields of a map that no column of this file supplied: a required one missing is why a parse blocks. */
export function unmatchedFields(columns: RawColumnView[], entries: MapEntryView[]): MapEntryView[] {
  const headers = new Set(columns.map((c) => c.header));
  return entries.filter((e) => !headers.has(e.sourceColumn));
}
