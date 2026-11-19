"use client";

/** Saves a CSV the page built (lib/invoices/listView.ts, reconcile.ts) as a file, in the browser. */
export function saveCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** "invoices-2026-11-17.csv" */
export const datedName = (stem: string) => `${stem}-${new Date().toISOString().slice(0, 10)}.csv`;
