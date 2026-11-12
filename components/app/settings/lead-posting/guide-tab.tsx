"use client";

import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";
import type { LeadPostBoard } from "@/lib/leadPost/board";
import { GuideDoc } from "./guide-doc";
import { copyInstructions, downloadInstructions } from "./instructions";
import { CopyField, maskedAddress, TechnicalDetails } from "./shared";

/**
 * Vendor guide: the general instructions any vendor can be sent before they are connected — our own
 * field names, the address, the headers, the replies and a sample. Each vendor's own copy (in their
 * field names) is in their sheet.
 */
export function GuideTab({ board, origin }: { board: LeadPostBoard; origin: string }) {
  const postingUrl = `${origin}${board.postingPath}`;
  return (
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <GuideDoc input={{ agencyName: board.agencyName, postingUrl }} />
      </div>
      <TableCard className="w-full shrink-0 xl:w-[340px]" title="Send the guide">
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="m-0 text-sm text-[var(--body)]">For a vendor you are talking to. Once they are connected, their own copy uses their field names.</p>
          <Button type="button" variant="outline" onClick={() => void copyInstructions(null)}>Copy the guide</Button>
          <Button type="button" variant="outline" onClick={() => downloadInstructions(null)}>Download PDF</Button>
          <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
            <span className="text-label text-[var(--body)]">Posting address</span>
            <CopyField label="Posting address" value={postingUrl} shown={maskedAddress(postingUrl)} />
          </div>
          {/* Kept for vendors set up before the per-agency address: the older shared address takes the
              key in the header, or in the path for systems that cannot set one. */}
          <TechnicalDetails rows={[
            { label: "Posting address", value: postingUrl },
            { label: "Older address", value: `${origin}/api/leads/post` },
            { label: "Key in the path", value: `${origin}/api/leads/post/<key>` },
          ]} />
        </div>
      </TableCard>
    </div>
  );
}
