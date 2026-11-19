"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { auditQueryString, parseAuditLogFilters } from "@/lib/audit/logView";

/**
 * Export CSV on the Audit log's title line (admin round 1, monitoring.html screen 5): a download of what the list's
 * filters match, read from the address so the file is the list on screen (GET /api/admin/audit-log/export, newest
 * first, at most 5,000 entries, the same per-actor rule). A plain link: nothing is written.
 */
export function AuditExportButton({ isSuperAdmin, limit }: { isSuperAdmin: boolean; limit: number }) {
  const params = useSearchParams();
  const query = auditQueryString(parseAuditLogFilters(params, AUDIT_ACTIONS), isSuperAdmin, false);
  return (
    <a
      href={`/api/admin/audit-log/export${query ? `?${query}` : ""}`}
      download
      className={buttonVariants({ variant: "outline" })}
      title={`The entries these filters match, newest first, up to ${limit.toLocaleString("en-US")}`}
    >
      <Download aria-hidden />
      Export CSV
    </a>
  );
}
