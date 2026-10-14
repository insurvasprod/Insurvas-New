"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { FILE_TYPE_LABELS, type CarrierFileType } from "@/lib/ingestion/constants";
import type { CarrierChoice } from "@/lib/ingestion/path";
import { notify } from "@/lib/notify";

/**
 * "Who sent this?" (Owner request 2026-10-14) · a file that arrived without a carrier. The file
 * checker's suggestions (layouts whose columns match the file), and a small form to confirm the
 * carrier, type and date. Notion LA-4.1 attributes automatic files by path without opening them,
 * so the checker only SUGGESTS; nothing happens until a person CONFIRMS here.
 */
export type AttributeSuggestion = {
  layoutKey: string;
  layoutName: string;
  fileType: CarrierFileType;
  carriers: Array<{ id: string; name: string }>;
  carrierId: string | null;
  fit: number;
  matched: number;
  total: number;
  missingRequired: string[];
  pdfRows: number | null;
};

const selectClass = `${toolbarControl} w-full`;

function who(suggestion: AttributeSuggestion): string {
  const picked = suggestion.carriers.find((carrier) => carrier.id === suggestion.carrierId);
  if (picked) return picked.name;
  const names = suggestion.carriers.map((carrier) => carrier.name);
  if (!names.length) return suggestion.layoutName;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function howWell(suggestion: AttributeSuggestion): string {
  if (suggestion.pdfRows !== null) return `${suggestion.matched} of ${suggestion.total} column names found · ${suggestion.pdfRows.toLocaleString("en-US")} ${suggestion.pdfRows === 1 ? "row" : "rows"} read`;
  return `${suggestion.matched} of ${suggestion.total} columns match`;
}

export function CarrierFileAttribute({ fileId, suggestions, carriers, initial, readOnly }: {
  fileId: string;
  suggestions: AttributeSuggestion[];
  carriers: CarrierChoice[];
  initial: { carrierId: string | null; fileType: CarrierFileType | null; fileDate: string | null };
  readOnly: boolean;
}) {
  const router = useRouter();
  const [carrierId, setCarrierId] = useState(initial.carrierId ?? "");
  const [fileType, setFileType] = useState<CarrierFileType | "">(initial.fileType ?? "");
  const [fileDate, setFileDate] = useState(initial.fileDate ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function use(suggestion: AttributeSuggestion) {
    if (suggestion.carrierId) setCarrierId(suggestion.carrierId);
    else if (suggestion.carriers.length && !suggestion.carriers.some((carrier) => carrier.id === carrierId)) setCarrierId("");
    setFileType(suggestion.fileType);
    setProblem(null);
  }

  async function confirm() {
    if (!carrierId || !fileType || !fileDate) {
      setProblem("Choose the carrier and the type, and enter the file's date.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/app/carrier-files/${fileId}/attribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier_id: carrierId, file_type: fileType, file_date: fileDate }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The file could not be given its carrier.");
      notify.done("Saved. The file is being read now.");
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The file could not be given its carrier.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableCard title="Who sent this?" description="The file came in without a carrier. These carriers' layouts match its columns. Check, then confirm.">
      {suggestions.length === 0 ? (
        <EmptyState title="No layout matches this file" hint="Choose the carrier, type and date below yourself." />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              <th>Looks like</th>
              <th className="w-[140px]">Type</th>
              <th className="w-[240px]">Match</th>
              <th className="w-[96px] text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion, index) => (
              <tr key={suggestion.layoutKey + suggestion.fileType}>
                <td>
                  <span className="block font-semibold text-foreground">{who(suggestion)}</span>
                  <span className="block max-w-[360px] truncate text-xs text-muted-foreground" title={suggestion.layoutName}>{suggestion.layoutName}</span>
                </td>
                <td>{FILE_TYPE_LABELS[suggestion.fileType]}</td>
                <td>
                  <StatusChip tone={index === 0 && suggestion.fit >= 80 && !suggestion.missingRequired.length ? "good" : suggestion.missingRequired.length ? "warning" : "neutral"}>{suggestion.fit}%</StatusChip>
                  <span className="block text-xs text-muted-foreground">{howWell(suggestion)}</span>
                  {suggestion.missingRequired.length > 0 && <span className="block truncate text-xs text-[var(--warning-ink)]" title={suggestion.missingRequired.join(", ")}>Missing: {suggestion.missingRequired.join(", ")}</span>}
                </td>
                <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => use(suggestion)}>Use this</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid gap-4 border-t border-border px-4 py-4 text-sm sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="attribute-carrier">Carrier</Label>
          <select id="attribute-carrier" className={selectClass} value={carrierId} onChange={(event) => setCarrierId(event.target.value)}>
            <option value="">Choose a carrier</option>
            {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="attribute-type">Type</Label>
          <select id="attribute-type" className={selectClass} value={fileType} onChange={(event) => setFileType(event.target.value as CarrierFileType | "")}>
            <option value="">Choose a type</option>
            {(Object.keys(FILE_TYPE_LABELS) as CarrierFileType[]).map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="attribute-date">File date</Label>
          <Input id="attribute-date" type="date" className="h-9" value={fileDate} onChange={(event) => setFileDate(event.target.value)} />
        </div>
        <Button type="button" disabled={busy || readOnly} title={readOnly ? "The account is read-only." : undefined} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm"}</Button>
        {problem && <p role="alert" className="m-0 text-sm font-medium text-[var(--error-ink)] sm:col-span-4">{problem}</p>}
      </div>
    </TableCard>
  );
}
