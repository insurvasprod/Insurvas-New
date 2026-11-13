"use client";

import { useEffect } from "react";

import { MenuCard, type MenuCardGroup } from "@/components/ui/menu-card";
import { Meter } from "@/components/ui/stat";

import { markRead, useReadPages } from "./docs-reading";

export type DocsMenuPage = { slug: string; title: string; chapter: string; stepKey?: string; optional?: boolean };
export type DocsMenuChapter = { key: string; title: string };

/**
 * Docs' menu (R4 rework, owner 2026-11-13: "smushed together and hard to differentiate pages"). Each chapter is a
 * numbered row with its progress; the chapter you are in is open, the rest open on a click. Pages sit under their
 * chapter on a guide line, each with a ring: green once read (or, for a setup step, once your agency has done it).
 * The setup chapter splits into Required and Optional. Reading progress leads the menu.
 */
export function DocsMenu({ pages, chapters, activeSlug, done }: {
  pages: DocsMenuPage[];
  chapters: DocsMenuChapter[];
  activeSlug?: string;
  done: string[];
  readyDone?: number;
  readyTotal?: number;
}) {
  const read = useReadPages();
  useEffect(() => { if (activeSlug) markRead(activeSlug); }, [activeSlug]);
  const doneSet = new Set(done);
  const isDone = (page: DocsMenuPage) => (page.chapter === "setup" && page.stepKey ? doneSet.has(page.stepKey) : read.has(page.slug));

  const groups: MenuCardGroup[] = chapters.map((chapter, index) => {
    const inChapter = pages.filter((page) => page.chapter === chapter.key);
    return {
      key: chapter.key,
      label: chapter.title,
      number: index + 1,
      progress: { done: inChapter.filter(isDone).length, total: inChapter.length },
      ...(chapter.key === "setup" ? { sections: [{ key: "required", label: "Required to sell" }, { key: "optional", label: "Optional settings" }] } : {}),
      items: inChapter.map((page) => ({
        key: page.slug,
        label: page.title,
        href: `/app/docs/${page.slug}`,
        active: page.slug === activeSlug,
        state: isDone(page) ? "done" as const : page.slug === activeSlug ? "current" as const : "todo" as const,
        ...(chapter.key === "setup" ? { section: page.optional ? "optional" : "required" } : {}),
      })),
    };
  }).filter((group) => group.items.length > 0);

  const readable = pages.filter((page) => page.chapter !== "setup");
  const readCount = readable.filter((page) => read.has(page.slug)).length;

  return (
    <MenuCard
      label="Docs"
      header={
        <>
          <p className="m-0 flex items-baseline gap-2 text-sm font-semibold text-[var(--ink)]">Contents <span className="ml-auto text-xs font-normal tabular-nums text-[var(--muted)]">{readCount} of {readable.length} read</span></p>
          <Meter value={readCount} max={Math.max(readable.length, 1)} tone="primary" label={`${readCount} of ${readable.length} pages read`} className="mt-2" />
        </>
      }
      filterPlaceholder="Find a page"
      top={[{ key: "start", label: "Start here", href: "/app/docs", active: !activeSlug }]}
      groups={groups}
      className="lg:h-full"
    />
  );
}
