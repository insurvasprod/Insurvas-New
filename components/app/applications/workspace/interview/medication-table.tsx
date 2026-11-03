"use client";

/**
 * The medication list (LA-3.2; board l3-ws-interview, "Medications"). Never a free-text box: one
 * row per medication — name, dose, since, prescribed for — so the carrier's reviewer and the QA
 * engine can read each drug. The name suggests from the medication list as it is typed, and anything
 * can still be typed. A reason that is not known says so ("Ask what it was prescribed for").
 */

import { useState } from "react";
import { X } from "lucide-react";

import { control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { MedicationRow } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { useMedicationSuggest } from "./use-medication-suggest";

const DATALIST_ID = "medication-name-suggestions";
const cell = cn(control, "mt-0");

export function newMedicationRow(): MedicationRow {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}`;
  return { id, name: "", dose: "", since: "", prescribedFor: "", prescribedForUnknown: false };
}

export function MedicationTable({
  id,
  rows,
  onChange,
  readOnly,
  sample,
}: {
  /** The DOM id QA deep links land on. */
  id: string;
  rows: MedicationRow[];
  onChange: (rows: MedicationRow[]) => void;
  readOnly: boolean;
  sample: boolean;
}) {
  // Suggestions follow whichever name box has focus.
  const [query, setQuery] = useState("");
  const suggestions = useMedicationSuggest(query, sample);
  const patch = (rowId: string, change: Partial<MedicationRow>) => onChange(rows.map((r) => (r.id === rowId ? { ...r, ...change } : r)));

  return (
    <div id={id} tabIndex={-1} className="overflow-x-auto outline-none">
      <datalist id={DATALIST_ID}>
        {suggestions.map((m) => <option key={m} value={m} />)}
      </datalist>
      <table className="portal-lead-table w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col">Medication</th>
            <th scope="col" className="w-[110px]">Dose</th>
            <th scope="col" className="w-[110px]">Since</th>
            <th scope="col">Prescribed for</th>
            {!readOnly && <th scope="col" className="w-10 text-right"><span className="sr-only">Remove</span></th>}
          </tr>
        </thead>
        <tbody className="m-seq">
          {rows.length === 0 && (
            <tr className="m-row">
              <td colSpan={readOnly ? 4 : 5} className="text-muted-foreground">No medications recorded.</td>
            </tr>
          )}
          {rows.map((r) => {
            const label = r.name || "this medication";
            return (
              <tr key={r.id} className="m-row align-middle">
                <td>
                  <input
                    id={`med-${r.id}-name`}
                    aria-label="Medication"
                    list={DATALIST_ID}
                    autoComplete="off"
                    className={cn(cell, "min-w-36")}
                    value={r.name}
                    disabled={readOnly}
                    placeholder="Start typing"
                    onFocus={(e) => setQuery(e.target.value)}
                    onChange={(e) => { setQuery(e.target.value); patch(r.id, { name: e.target.value }); }}
                  />
                </td>
                <td>
                  <input aria-label={`Dose of ${label}`} className={cell} value={r.dose} disabled={readOnly} placeholder="10 mg" onChange={(e) => patch(r.id, { dose: e.target.value })} />
                </td>
                <td>
                  <input aria-label={`Taking ${label} since`} className={cell} value={r.since} disabled={readOnly} placeholder="Year" onChange={(e) => patch(r.id, { since: e.target.value })} />
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    {r.prescribedForUnknown ? (
                      <StatusChip tone="warning">Ask what it was prescribed for</StatusChip>
                    ) : (
                      <input aria-label={`What ${label} is prescribed for`} className={cn(cell, "min-w-36")} value={r.prescribedFor} disabled={readOnly} placeholder="Condition" onChange={(e) => patch(r.id, { prescribedFor: e.target.value })} />
                    )}
                    <label className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={r.prescribedForUnknown}
                        disabled={readOnly}
                        onChange={(e) => patch(r.id, { prescribedForUnknown: e.target.checked, prescribedFor: e.target.checked ? "" : r.prescribedFor })}
                      />
                      Unknown
                    </label>
                  </div>
                </td>
                {!readOnly && (
                  <td className="text-right">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>
                      <X aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
