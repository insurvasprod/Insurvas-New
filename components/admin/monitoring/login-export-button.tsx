"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";

/**
 * Login activity's Export CSV (admin round 1, monitoring.html screen 2): a download of the attempts the filters in
 * the address match, from GET /api/admin/activity/export, which applies the same staff rule as the table.
 */
export function LoginExportButton() {
  const params = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["outcome", "actor", "range", "q", "lens"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return (
    <a href={`/api/admin/activity/export${text ? `?${text}` : ""}`} className={buttonVariants({ variant: "outline" })} download>
      <Download aria-hidden />
      Export CSV
    </a>
  );
}
