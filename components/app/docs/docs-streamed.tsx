import { Suspense, type ComponentProps } from "react";

import { DocsMenu } from "@/components/app/docs/docs-menu";
import { DocsSearch } from "@/components/app/docs/docs-search";
import { StreamSection } from "@/components/ui/stream-section";
import { DOC_CHAPTERS, allDocPages, docsSearchIndex } from "@/lib/docs/content";
import { menuModules, type loadDocsState } from "@/lib/docs/state";

/**
 * Docs, frame first (UI-CONSISTENCY §7a, 2026-11-18): every Docs page draws its title, search box and frame at once
 * and streams the parts that know the reader (their setup steps, their agency's done tasks) from one started read of
 * `loadDocsState()`.
 */
export type DocsState = ReturnType<typeof loadDocsState>;

/** The search box at once (Docs pages only), then with this reader's Insurvas steps once they are read. */
export function DocsSearchStreamed({ state }: { state: DocsState }) {
  return <Suspense fallback={<DocsSearch entries={docsSearchIndex([])} />}><DocsSearchFor state={state} /></Suspense>;
}

async function DocsSearchFor({ state }: { state: DocsState }) {
  const { viewer } = await state;
  return <DocsSearch entries={docsSearchIndex(viewer.insurvas)} />;
}

type MenuPlace = Pick<ComponentProps<typeof DocsMenu>, "activeSlug" | "activeModule" | "activeSettings">;

/** The Docs menu, in its own block: the reference shelf and chapters are fixed, the done ticks are the reader's. */
export function DocsMenuStreamed({ state, ...place }: { state: DocsState } & MenuPlace) {
  return <StreamSection shape="rows" rows={10} columns={1} label="Loading the Docs menu"><DocsMenuFor state={state} {...place} /></StreamSection>;
}

async function DocsMenuFor({ state, ...place }: { state: DocsState } & MenuPlace) {
  const { modules, settingsDone, settingsTracked } = await state;
  const reference = allDocPages().filter((item) => item.chapter !== "setup").map((item) => ({ slug: item.slug, title: item.title, chapter: item.chapter }));
  return <DocsMenu modules={menuModules(modules)} settingsDone={settingsDone} settingsTracked={settingsTracked} reference={reference} chapters={DOC_CHAPTERS.map(({ key, title }) => ({ key, title }))} {...place} />;
}
