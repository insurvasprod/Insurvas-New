"use client";

import Link from "next/link";
import { Check } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

import type { DocsMenuChapter, DocsMenuPage } from "./docs-menu";
import { useReadPages } from "./docs-reading";

/**
 * Docs home, R4 D1·A: "Your journey" across the top (the six chapters as one road, filled up to where you are),
 * then the six chapters as boxes that stretch to the bottom of the window, each listing its pages.
 */
export function DocsHome({ pages, chapters, done }: { pages: DocsMenuPage[]; chapters: (DocsMenuChapter & { summary: string })[]; done: string[] }) {
  const read = useReadPages();
  const doneSet = new Set(done);
  const isDone = (page: DocsMenuPage) => (page.stepKey && page.chapter === "setup" ? doneSet.has(page.stepKey) : read.has(page.slug));
  const rows = chapters.map((chapter) => {
    const inChapter = pages.filter((page) => page.chapter === chapter.key);
    const finished = inChapter.filter(isDone).length;
    return { ...chapter, pages: inChapter, finished };
  }).filter((row) => row.pages.length > 0);
  const current = rows.find((row) => row.finished < row.pages.length) ?? null;
  const keepReading = current?.pages.find((page) => !isDone(page)) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section aria-label="Your journey" className="flex flex-col gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--color-card)] p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Your journey</h2>
          <span className="text-xs text-[var(--muted)]">from no licence to your first commission check</span>
          <span className="flex-1" />
          {keepReading ? <Link href={`/app/docs/${keepReading.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Keep reading: {keepReading.title} ›</Link> : null}
        </div>
        <ol className="m-0 grid list-none grid-cols-2 gap-y-4 p-0 md:grid-cols-3 xl:grid-cols-6">
          {rows.map((row, index) => {
            const complete = row.finished === row.pages.length;
            const now = row.key === current?.key;
            return (
              <li key={row.key} className="relative pr-2">
                {index < rows.length - 1 ? <span aria-hidden="true" className={cn("absolute top-4 right-0 left-10 hidden h-0.5 xl:block", complete ? "bg-[var(--primary)]" : "bg-[var(--border)]")} /> : null}
                <Link href={`/app/docs/${row.pages[0].slug}`} className="group relative flex flex-col gap-1 no-underline">
                  <span className={cn("relative z-[1] inline-flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold",
                    complete ? "border-transparent bg-[var(--success-surface)] text-[var(--success)]" : now ? "border-[var(--primary)] bg-[var(--color-card)] text-[var(--accent-ink)]" : "border-[var(--border)] bg-[var(--color-card)] text-[var(--muted)]")}>
                    {complete ? <Check className="size-4" strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="text-sm font-semibold text-[var(--ink)] group-hover:underline">{row.title}</span>
                  <span className="text-xs tabular-nums text-[var(--muted)]">{row.key === "setup" ? `${row.finished} of ${row.pages.length} done` : complete ? `${row.pages.length} pages · read` : `${row.finished} of ${row.pages.length} read`}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="grid flex-1 auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, index) => {
          const complete = row.finished === row.pages.length;
          const now = row.key === current?.key;
          const listed = row.key === "setup" ? row.pages.filter((page) => !isDone(page)).slice(0, 4) : row.pages;
          return (
            <section key={row.key} aria-labelledby={`chapter-${row.key}`} className={cn("flex min-h-[180px] flex-col gap-2.5 rounded-[16px] border bg-[var(--color-card)] p-4", now ? "border-[var(--primary)]" : "border-[var(--border)]")}>
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]">{index + 1}</span>
                <h3 id={`chapter-${row.key}`} className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{row.title}</h3>
                {complete ? <StatusChip tone="good">{row.key === "setup" ? "Done" : "Read"}</StatusChip> : now ? <StatusChip tone="info">{row.key === "setup" ? "In progress" : "Reading"}</StatusChip> : null}
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {row.key === "setup" ? <li className="text-xs text-[var(--muted)]">Each Get set up step: its video, every click, and Do it in Insurvas.</li> : null}
                {listed.map((page) => (
                  <li key={page.slug}>
                    <Link href={`/app/docs/${page.slug}`} className="flex items-center gap-1.5 text-xs text-[var(--muted)] no-underline hover:text-[var(--ink)]">
                      {isDone(page) ? <Check aria-label="Done" className="size-3.5 shrink-0 text-[var(--success)]" /> : <span aria-hidden="true" className="w-3.5 shrink-0 text-center">·</span>}
                      <span className="truncate">{row.key === "setup" ? `Next: ${page.title}` : page.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <span className="flex-1" />
              <Meter value={row.finished} max={Math.max(row.pages.length, 1)} tone="primary" label={`${row.finished} of ${row.pages.length}`} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
