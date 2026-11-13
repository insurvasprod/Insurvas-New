import { ViewTabs } from "@/components/ui/view-tabs";

export const FILES_IN_HREF = "/app/book-setup/how-files-arrive";

export type FilesInTab = "carriers" | "email" | "bucket";

/** Each tab's count, or null when that page did not load it (the badge is left off rather than guessed). */
export type FilesInCounts = { carriers: number | null; email: number | null; bucket: number | null };

/**
 * Carrier sync › Files in (r7 4·A, owner 2026-11-10 "Build all four"): the three ways a file comes in are the
 * sub-page bar on the title line — Your carriers · Email · Bucket — instead of three cards above the table. Each
 * tab keeps its own address (/how-files-arrive, /email, /bucket), so every old link lands on its tab.
 * Your carriers counts the carriers not done yet; Email the known senders; Bucket the missing files, in red.
 */
export function FilesInTabs({ active, counts }: { active: FilesInTab; counts: FilesInCounts }) {
  return (
    <ViewTabs
      label="Ways files come in"
      value={active}
      tabs={[
        { key: "carriers", label: "Your carriers", href: FILES_IN_HREF, count: counts.carriers || null },
        { key: "email", label: "Email", href: `${FILES_IN_HREF}/email`, count: counts.email },
        { key: "bucket", label: "Bucket", href: `${FILES_IN_HREF}/bucket`, count: counts.bucket || null, tone: "danger" },
      ]}
    />
  );
}

/** The trail for a tab under Files in: Carrier sync › Files in › the tab. */
export const filesInCrumbs = (tab: string) => [{ label: "Carrier sync", href: "/app/needs-you" }, { label: "Files in", href: FILES_IN_HREF }, { label: tab }];
