import Link from "next/link";

import { DocsFrame } from "@/components/app/docs/docs-shell";
import { DocsHome } from "@/components/app/docs/docs-home";
import { DocsMenu } from "@/components/app/docs/docs-menu";
import { DocsSearch } from "@/components/app/docs/docs-search";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DOC_CHAPTERS, docsMenuPages, docsSearchIndex } from "@/lib/docs/content";
import { loadDocsViewer } from "@/lib/docs/viewer";

/**
 * Docs home, R4 D1·A (owner 2026-11-13): the Settings-style menu on the left; search in the middle of the title
 * line; on the right "Your journey" and the six chapters, filling the full width and height.
 */
export default async function DocsPage() {
  const viewer = await loadDocsViewer();
  const pages = docsMenuPages();
  const done = [...viewer.done];
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title="Docs"
        description="How insurance and Insurvas work: getting licensed and contracted, every setup step, selling within the rules, and after the sale."
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearch entries={docsSearchIndex(viewer.insurvas)} /></div>}
        actions={viewer.ready.total > 0 ? <Link href="/app/setup" className={buttonVariants({ variant: "outline" })}>Get set up · {viewer.ready.done} of {viewer.ready.total}</Link> : null}
      />
      <DocsFrame menu={<DocsMenu pages={pages} chapters={DOC_CHAPTERS.map(({ key, title }) => ({ key, title }))} done={done} />}>
        <DocsHome pages={pages} chapters={[...DOC_CHAPTERS]} done={done} />
      </DocsFrame>
    </div>
  );
}
