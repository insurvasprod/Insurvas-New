import Link from "next/link";
import { ArrowRight, BookOpen, Rocket } from "lucide-react";

import { DocsDirectory, directoryCard, type DirectoryModule } from "@/components/app/docs/docs-directory";
import { SegmentBar } from "@/components/app/docs/docs-map";
import { SettingsDirectory } from "@/components/app/docs/settings-directory";
import { Meter } from "@/components/ui/stat";
import { PageHeader } from "@/components/ui/page-header";
import { DOC_CHAPTERS, allDocPages } from "@/lib/docs/content";
import { loadDocsState } from "@/lib/docs/state";
import { cn } from "@/lib/utils";
import { StreamSection } from "@/components/ui/stream-section";
import { DocsSearchStreamed, type DocsState } from "@/components/app/docs/docs-streamed";

/**
 * Docs home, R7 (owner 2026-11-17: "horrible… easier for the eyes to read and shift from one to another; look at how
 * docs are done on the premium platforms"). The shape those homes share: search first, then a short row of where to
 * start (your next task, Get set up, your progress), then a directory of every area on equal shelves, then the
 * reference shelf. No arrows, no map: the same small pattern repeated, so the eye moves across it.
 */
export default function DocsPage() {
  // Frame first (UI-CONSISTENCY §7a): the title and the search box draw at once; the reader's progress streams in.
  const state = loadDocsState();
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title="Docs"
        description="How to do each thing in Insurvas, step by step on the real screens."
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={state} /></div>}
      />
      <StreamSection shape="cards" cards={3}><DocsBody state={state} /></StreamSection>
    </div>
  );
}

async function DocsBody({ state }: { state: DocsState }) {
  const { viewer, modules, next } = await state;
  const listed = modules.filter((entry) => entry.tasks.length > 0);
  const directory: DirectoryModule[] = listed.map((entry) => ({
    key: entry.module.key,
    title: entry.module.title,
    covers: entry.module.covers,
    done: entry.done,
    total: entry.total,
    tasks: [...entry.tasks].sort((a, b) => Number(a.done === true) - Number(b.done === true)).map((item) => ({ slug: item.task.slug, title: item.task.title, done: item.done === true })),
  }));
  const counted = directory.filter((item) => item.total > 0);
  const done = counted.reduce((sum, item) => sum + item.done, 0);
  const total = counted.reduce((sum, item) => sum + item.total, 0);
  const reference = allDocPages().filter((page) => page.chapter !== "setup");
  const chapters = DOC_CHAPTERS.filter((chapter) => reference.some((page) => page.chapter === chapter.key));
  const nextModule = next ? listed.find((entry) => entry.module.key === next.task.module)?.module.title : null;
  const start = `${directoryCard} flex min-w-0 items-center gap-3.5 px-4 py-3.5 no-underline transition-colors hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]`;

  return (
    <>
      {/* Where to start: three cards of the same height, one line of type each. */}
      <section aria-label="Start here" className="grid gap-3 md:grid-cols-3">
        {next ? (
          <Link href={`/app/docs/${next.task.slug}`} className={cn(start, "border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]")}>
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary)] text-[var(--primary-foreground)]"><ArrowRight className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-[var(--muted)]">Next for you{nextModule ? ` · ${nextModule}` : ""}</span>
              <span className="block truncate text-sm font-semibold text-[var(--ink)]">{next.task.title}</span>
            </span>
          </Link>
        ) : (
          <div className={start}>
            <span className="min-w-0 flex-1"><span className="block text-xs text-[var(--muted)]">Next for you</span><span className="block text-sm font-semibold text-[var(--ink)]">Everything is done</span></span>
          </div>
        )}
        <Link href="/app/setup" className={start}>
          <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Rocket className="size-4" /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline gap-2"><span className="text-sm font-semibold text-[var(--ink)]">Get set up</span>{viewer.ready.total > 0 ? <span className="text-xs text-[var(--muted)] tabular-nums">{viewer.ready.done} of {viewer.ready.total} Ready to sell</span> : null}</span>
            {viewer.ready.total > 0 ? <Meter value={viewer.ready.done} max={viewer.ready.total} tone="primary" label="Ready to sell steps done" /> : null}
          </span>
        </Link>
        <div className={cn(start, "hover:border-[var(--border)]")}>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-baseline gap-2"><span className="text-sm font-semibold text-[var(--ink)]">Your Insurvas</span><span className="text-xs text-[var(--muted)] tabular-nums">{done} of {total} tasks done in your agency</span></span>
            <SegmentBar modules={counted} />
          </span>
        </div>
      </section>

      <DocsDirectory modules={directory} />

      <SettingsDirectory />

      <section aria-label="Reference" className={`${directoryCard} flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><BookOpen aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />Reference</span>
        <span className="text-xs text-[var(--muted)]">The insurance background, {reference.length} pages</span>
        {chapters.map((chapter) => {
          const first = reference.find((page) => page.chapter === chapter.key);
          return first ? <Link key={chapter.key} href={`/app/docs/${first.slug}`} className="text-sm text-[var(--body)] no-underline hover:text-[var(--accent-ink)] hover:underline">{chapter.title}</Link> : null;
        })}
      </section>
    </>
  );
}
