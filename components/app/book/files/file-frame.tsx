import type { ReactNode } from "react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { MoreMenu } from "@/components/app/book/files/more-menu";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { CarrierFileReread } from "@/components/app/carrier-file-reread";
import { ViewTabs } from "@/components/ui/view-tabs";
import type { CarrierFileType } from "@/lib/ingestion/constants";
import type { FileHead } from "@/lib/ingestion/fileOutcomeStore";
import { fileHref } from "@/lib/ingestion/trace";

export type FileTab = "rows" | "changes" | "commissions" | "history";


/**
 * The tabs a file has: Changes only on a policy file, Commissions only on a commission file (round 3, rule 3),
 * and on every file its Run history: each time the system read it (owner 2026-11-02, was the list's More menu).
 * Round 4 (owner 2026-11-02): no Overview — it and Rows showed the same thing; Rows is the file's page.
 */
export const fileTabsOf = (head: Pick<FileHead, "fileType">): FileTab[] => (head.fileType === "commissions" ? ["rows", "commissions", "history"] : ["rows", "changes", "history"]);

/**
 * Book of business › Files › a file: the detail page's frame. Owner 2026-11-02: the title line is the
 * file's name, then its tabs Rows · Changes (a policy file) or Commissions (a commission file)
 * on the cards' left edge as on every merged page, then Read again and Download with "Replace with a
 * corrected file" in More. No status chip and no line of facts under the name. The whole file is the Rows tab's "As sent"
 * action, at its own address (/whole). Every tab of the file renders inside this.
 */
export async function FileFrame({ head, tenantId, tab, counts, readOnly, more = [], children }: {
  head: FileHead;
  /** For the corrected file's carriers: Settings › Carriers' (LA-0.4). */
  tenantId: string;
  tab: FileTab;
  /** Round 4: the tab's own extras (Rows: the file as sent, the rows exported), in More so the toolbar is one row. */
  more?: Array<{ label: string; href: string }>;
  counts?: { rows?: number | null; changes?: number | null; history?: number | null };
  readOnly: boolean;
  children: ReactNode;
}) {
  const base = fileHref(head.id);
  // The agency's carriers (Settings › Carriers) for the corrected file's pop-up.
  const canReplace = !readOnly && Boolean(head.carrierId && head.fileType);
  const carriers = canReplace ? await fileCarrierChoices(tenantId) : [];
  const labels: Record<FileTab, string> = { rows: "Rows", changes: "Changes", commissions: "Commissions", history: "Run history" };
  const tabCounts: Partial<Record<FileTab, number | null>> = { rows: counts?.rows ?? head.rowCount, changes: counts?.changes ?? null, history: counts?.history ?? null };

  return (
    <DataInPage
      step="files"
      title={head.name}
      lead={
        <ViewTabs
          label="This file"
          value={tab}
          tabs={fileTabsOf(head).map((key) => ({ key, label: labels[key], count: tabCounts[key] ?? null, href: key === "rows" ? base : `${base}?tab=${key}` }))}
        />
      }
      actions={<>
        {head.rowCount !== null && !readOnly && <CarrierFileReread fileId={head.id} />}
        <CarrierFileDownload fileId={head.id} label="Download" />
        {(canReplace || more.length > 0) && (
          <MoreMenu
            items={more}
            replace={canReplace ? {
              label: "Replace with a corrected file",
              carriers,
              // A corrected file is the same carrier, type and day, so it supersedes this one, which stays listed.
              preset: { carrierId: head.carrierId, fileType: head.fileType as CarrierFileType, fileDate: head.fileDate, agency: head.agency },
            } : undefined}
          />
        )}
      </>}
    >
      {children}
    </DataInPage>
  );
}
