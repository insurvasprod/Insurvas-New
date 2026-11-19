"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toCsv } from "@/lib/revenue/present";

/**
 * "Export CSV" on Revenue (admin round 1, billing-r2 screen 11): the figures the page shows for the chosen period —
 * tiles, MRR movement, plan mix, funnel, customers & churn and the cohorts — as one CSV, built from what the server
 * already rendered, so the file and the screen cannot disagree. No round trip, nothing written.
 */
export function RevExportButton({ rows, fileName }: { rows: Array<Array<string | number | null>>; fileName: string }) {
  function download() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Button type="button" variant="outline" onClick={download}>
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
