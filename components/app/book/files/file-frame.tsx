import { Suspense, type ReactNode } from "react";
import { ChevronDown, RotateCw } from "lucide-react";

import { DataInPage, RecordName } from "@/components/app/data-in/data-in-page";
import { fileCarrierChoices } from "@/lib/carriers/agency";
import { MoreMenu } from "@/components/app/book/files/more-menu";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { FileReread } from "@/components/app/book/files/file-reread";
import { Button } from "@/components/ui/button";
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

/** The tab the address asks for, when this file has it; else Rows (?tab=overview and ?tab=rows land on it). */
export const fileTabOf = (head: Pick<FileHead, "fileType">, asked: string | undefined): FileTab => fileTabsOf(head).find((key) => key === asked) ?? "rows";

const LABELS: Record<FileTab, string> = { rows: "Rows", changes: "Changes", commissions: "Commissions", history: "Run history" };

export type FileCounts = { rows?: number | null; changes?: number | null; history?: number | null };

/**
 * Book of business › Files › a file: the detail page's frame. Owner 2026-11-02: the title line is the
 * file's name, then its tabs Rows · Changes (a policy file) or Commissions (a commission file)
 * on the cards' left edge as on every merged page, then Read again and Download with "Replace with a
 * corrected file" in More. No status chip and no line of facts under the name. The whole file is the Rows tab's "As sent"
 * action, at its own address (/whole). Every tab of the file renders inside this.
 *
 * Frame first (UI-CONSISTENCY §7a, 2026-11-12): the frame never waits for the file. It takes the file's head as a
 * promise: the trail, the tabs (the address's guess, then the file's own) and Download draw at once; the name waits
 * behind its shape, Read again and More draw disabled until the head lands, and the tab counts fill in last (`counts`,
 * read by the page's own block). A file not found is the page's body to say (notFound()); the frame draws nothing more.
 */
export function FileFrame({ fileId, head, asked, tenantId, counts, readOnly, more, carriers, children }: {
  fileId: string;
  /** The file's head, read by the page and not awaited. */
  head: Promise<FileHead | null>;
  /** The tab the address asks for (?tab=); the file's head decides which it is. */
  asked?: string;
  /** For the corrected file's carriers: Settings › Carriers' (LA-0.4). */
  tenantId: string;
  /** Round 4: the tab's own extras (Rows: the file as sent, the rows exported), in More so the toolbar is one row. */
  more?: (head: FileHead, tab: FileTab) => Array<{ label: string; href: string }>;
  /** The tabs' counts, when the page works them out (rows defaults to the head's). */
  counts?: Promise<FileCounts>;
  /** The corrected file's carriers, when the page reads them already; else read here once the head says they're needed. */
  carriers?: Promise<Awaited<ReturnType<typeof fileCarrierChoices>>>;
  readOnly: boolean;
  children: ReactNode;
}) {
  // Until the head lands: the tabs a file has (a commission file's when the address asks for Commissions), no counts.
  const guess: FileTab = asked === "changes" || asked === "commissions" || asked === "history" ? asked : "rows";
  const guessTabs: FileTab[] = guess === "commissions" ? ["rows", "commissions", "history"] : ["rows", "changes", "history"];
  return (
    <DataInPage
      step="files"
      title={<RecordName read={head.then((one) => one?.name)} />}
      tabs={<Suspense fallback={<FileTabs fileId={fileId} keys={guessTabs} tab={guess} />}><HeadTabs head={head} asked={asked} counts={counts} /></Suspense>}
      actions={
        <Suspense fallback={<>
          {!readOnly && <Button type="button" variant="outline" disabled><RotateCw aria-hidden="true" />Read again</Button>}
          <CarrierFileDownload fileId={fileId} label="Download" />
          {!readOnly && <Button type="button" variant="outline" disabled>More<ChevronDown aria-hidden="true" /></Button>}
        </>}>
          <FileActions head={head} asked={asked} tenantId={tenantId} readOnly={readOnly} more={more} carriers={carriers} />
        </Suspense>
      }
    >
      {children}
    </DataInPage>
  );
}

function FileTabs({ fileId, keys, tab, counts = {} }: { fileId: string; keys: FileTab[]; tab: FileTab; counts?: Partial<Record<FileTab, number | null>> }) {
  const base = fileHref(fileId);
  return <ViewTabs label="This file" value={tab} tabs={keys.map((key) => ({ key, label: LABELS[key], count: counts[key] ?? null, href: key === "rows" ? base : `${base}?tab=${key}` }))} />;
}

/** The file's own tabs: with the rows' count at once, the others' when the page's block has them. */
async function HeadTabs({ head: read, asked, counts }: { head: Promise<FileHead | null>; asked?: string; counts?: Promise<FileCounts> }) {
  const head = await read;
  if (!head) return null;
  const keys = fileTabsOf(head);
  const tab = fileTabOf(head, asked);
  const now = <FileTabs fileId={head.id} keys={keys} tab={tab} counts={{ rows: head.rowCount }} />;
  return counts ? <Suspense fallback={now}><CountedTabs head={head} keys={keys} tab={tab} counts={counts} /></Suspense> : now;
}

async function CountedTabs({ head, keys, tab, counts: read }: { head: FileHead; keys: FileTab[]; tab: FileTab; counts: Promise<FileCounts> }) {
  const counts = await read.catch((): FileCounts => ({}));
  return <FileTabs fileId={head.id} keys={keys} tab={tab} counts={{ rows: counts.rows ?? head.rowCount, changes: counts.changes ?? null, history: counts.history ?? null }} />;
}

async function FileActions({ head: read, asked, tenantId, readOnly, more: moreOf, carriers: carriersRead }: {
  head: Promise<FileHead | null>;
  asked?: string;
  tenantId: string;
  readOnly: boolean;
  more?: (head: FileHead, tab: FileTab) => Array<{ label: string; href: string }>;
  carriers?: Promise<Awaited<ReturnType<typeof fileCarrierChoices>>>;
}) {
  const head = await read;
  if (!head) return null;
  // The agency's carriers (Settings › Carriers) for the corrected file's pop-up.
  const canReplace = !readOnly && Boolean(head.carrierId && head.fileType);
  const carriers = canReplace ? await (carriersRead ?? fileCarrierChoices(tenantId)) : [];
  const more = moreOf ? moreOf(head, fileTabOf(head, asked)) : [];
  return (
    <>
      {head.rowCount !== null && !readOnly && <FileReread fileId={head.id} />}
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
    </>
  );
}
