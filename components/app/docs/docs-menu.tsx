"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

import { MenuCard, type MenuCardGroup } from "@/components/ui/menu-card";
import { SETTINGS_DOC_GROUPS, SETTINGS_INDEX as SETTINGS_DOCS } from "@/lib/docs/settingsIndex";

import { SegmentBar } from "./docs-map";

export type DocsMenuModule = { key: string; title: string; done: number; total: number; tasks: { slug: string; title: string; done: boolean | null }[] };
export type DocsMenuReference = { slug: string; title: string; chapter: string };

/**
 * Docs' menu, R6 (owner 2026-11-16: Docs is for using Insurvas). One group per module: its guide ("How it works")
 * then its tasks, each ticked once your agency has done it. The header's one bar is split by module and counts only
 * what Insurvas sees done. The insurance background pages sit at the bottom under Reference.
 */
const WALKED_KEY = "docs-settings-walked";

/** The Settings pages this browser has walked through in Docs. */
export function readSettingsWalked(): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(WALKED_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

/** Marks a Settings page as walked (its last step reached in Docs). */
export function markSettingsWalked(slug: string) {
  try {
    const next = readSettingsWalked();
    next.add(slug);
    window.localStorage.setItem(WALKED_KEY, JSON.stringify([...next]));
    window.dispatchEvent(new Event(WALKED_KEY));
  } catch { /* storage blocked: the circle just stays open */ }
}

export function DocsMenu({ modules, reference, chapters, activeSlug, activeModule, activeSettings, settingsDone = [], settingsTracked = [] }: {
  modules: DocsMenuModule[];
  reference: DocsMenuReference[];
  chapters: { key: string; title: string }[];
  activeSlug?: string;
  activeModule?: string;
  /** A Settings page's slug, or "" for the Settings index. */
  activeSettings?: string;
  /** Settings pages whose Get set up steps are done, and the pages that have such a step (lib/docs/state.ts). */
  settingsDone?: string[];
  settingsTracked?: string[];
}) {
  // Settings pages walked in Docs in this browser (SettingsDoc writes them), for pages Insurvas can't check itself.
  const [read, setRead] = useState<Set<string>>(new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this browser's own list, read once after mount
    setRead(readSettingsWalked());
    // Ticks the page the moment its walk reaches the last step, without a reload.
    const refresh = () => setRead(readSettingsWalked());
    window.addEventListener(WALKED_KEY, refresh);
    return () => window.removeEventListener(WALKED_KEY, refresh);
  }, []);
  const counted = modules.filter((item) => item.total > 0);
  const done = counted.reduce((sum, item) => sum + item.done, 0);
  const total = counted.reduce((sum, item) => sum + item.total, 0);
  // Every group numbered, its pages indented on a guide line, as Get set up's menu draws them (owner 2026-11-17:
  // "fix the side bar"): one look for the whole menu.
  const groups: MenuCardGroup[] = modules.map((module, index) => ({
    key: module.key,
    label: module.title,
    number: index + 1,
    ...(module.total > 0 ? { progress: { done: module.done, total: module.total } } : {}),
    items: [
      { key: `${module.key}:guide`, label: "How it works", href: `/app/docs/modules/${module.key}`, active: activeModule === module.key && !activeSlug, icon: <BookOpen className="size-3.5" /> },
      ...module.tasks.map((task) => ({
        key: task.slug,
        label: task.title,
        href: `/app/docs/${task.slug}`,
        active: task.slug === activeSlug,
        state: task.done ? "done" as const : task.slug === activeSlug ? "current" as const : "todo" as const,
      })),
    ],
  }));
  // Settings, page by page (owner 2026-11-17: "at least make it like a drop down or a parent… and add a circle"):
  // each Settings group is its own folding group, like a module, and each page has its done circle. A page holding a
  // Get set up step is done when that step is; any other once you've walked it here in Docs (this browser).
  const isDone = (slug: string) => settingsDone.includes(slug) || (!settingsTracked.includes(slug) && read.has(slug));
  for (const group of SETTINGS_DOC_GROUPS) {
    const pages = SETTINGS_DOCS.filter((page) => page.group === group);
    if (pages.length === 0) continue;
    groups.push({
      key: `settings:${group}`,
      label: `Settings: ${group}`,
      number: groups.length + 1,
      progress: { done: pages.filter((page) => isDone(page.slug)).length, total: pages.length },
      items: pages.map((page) => ({
        key: `settings:${page.slug}`,
        label: page.title,
        href: `/app/docs/settings/${page.slug}`,
        active: page.slug === activeSettings,
        state: isDone(page.slug) ? "done" as const : page.slug === activeSettings ? "current" as const : "todo" as const,
      })),
    });
  }
  const chaptersUsed = chapters.filter((chapter) => reference.some((page) => page.chapter === chapter.key));
  if (reference.length > 0) {
    groups.push({
      key: "reference",
      label: "Reference",
      number: groups.length + 1,
      sections: chaptersUsed.map((chapter) => ({ key: chapter.key, label: chapter.title })),
      items: reference.map((page) => ({ key: page.slug, label: page.title, href: `/app/docs/${page.slug}`, active: page.slug === activeSlug, section: page.chapter })),
    });
  }
  return (
    <MenuCard
      label="Docs"
      header={
        <>
          <p className="m-0 flex items-baseline gap-2 text-sm font-semibold text-[var(--ink)]">Your Insurvas <span className="ml-auto text-xs font-normal tabular-nums text-[var(--muted)]">{done} of {total} done</span></p>
          <SegmentBar modules={counted.map((item) => ({ key: item.key, title: item.title, done: item.done, total: item.total }))} className="mt-2" />
          <p className="m-0 mt-1.5 text-xs text-[var(--muted)]">Tasks done in your agency, by module</p>
        </>
      }
      filterPlaceholder="Find a task"
      top={[
        { key: "home", label: "Docs home", href: "/app/docs", active: !activeSlug && !activeModule && activeSettings === undefined },
        { key: "settings:all", label: "Every settings page", href: "/app/docs/settings", active: activeSettings === "" },
      ]}
      groups={groups}
      className="lg:h-full"
    />
  );
}
