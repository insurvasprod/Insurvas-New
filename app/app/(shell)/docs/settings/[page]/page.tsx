import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsMenuStreamed, DocsSearchStreamed } from "@/components/app/docs/docs-streamed";
import { DocsFrame } from "@/components/app/docs/docs-shell";
import { SettingsDoc } from "@/components/app/docs/settings-doc";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { settingsDoc } from "@/lib/docs/settingsDocs";
import { SETTINGS_SHOTS } from "@/lib/docs/settingsShots";
import { settingsWalk } from "@/lib/docs/settingsWalks";
import { stepLabel } from "@/lib/docs/shotsFor";
import { loadDocsState } from "@/lib/docs/state";
import { docWheres } from "@/lib/docs/where";

/**
 * Docs › Settings › one page (owner 2026-11-17): the page walked through step by step on the real screen, each step
 * lit with what to do and why (lib/docs/settingsWalks.ts, photographed by scripts/docs-task-shots.mjs --settings),
 * and every setting on it for reference (lib/docs/settingsDocs.ts). What the page is for is in the title's (i).
 */
export default async function SettingsDocPage({ params, searchParams }: { params: Promise<{ page: string }>; searchParams: Promise<{ view?: string | string[] }> }) {
  const { page: slug } = await params;
  const query = await searchParams;
  const page = settingsDoc(slug);
  if (!page) notFound();
  const walk = settingsWalk(page.slug);
  const shots = SETTINGS_SHOTS[page.slug] ?? [];
  // Where each step happens (for its Explain panel): the page itself, or where a step's `at` moves to.
  const steps = walk?.steps ?? [];
  const wheres = docWheres(page.href, steps.map((step) => step.at));
  const moves = steps.map((step, at) => ({ say: step.say, ...(step.detail ? { detail: step.detail } : {}), photo: shots[at] ?? null, label: stepLabel(step.say), where: wheres[at] }));
  const view: "walk" | "all" = query.view === "all" || moves.length === 0 ? "all" : "walk";
  const fields = page.parts.reduce((sum, part) => sum + part.fields.length, 0);
  // Frame first: the walk and its settings are fixed text; only the menu's ticks and the search wait on the read.
  const state = loadDocsState();
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title={page.title}
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, { label: "Settings", href: "/app/docs/settings" }, { label: page.title }]}
        description={`${walk ? `${page.why} By the end: ${walk.outcome} ${moves.length} steps, about ${walk.minutes} min.` : page.why} Who can open it: ${page.who}`}
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={state} /></div>}
        actions={<>
          {moves.length > 0 ? (
            view === "all"
              ? <Link href={`/app/docs/settings/${page.slug}`} className={buttonVariants({ variant: "outline" })}>Step by step · {moves.length}</Link>
              : <Link href={`/app/docs/settings/${page.slug}?view=all`} className={buttonVariants({ variant: "outline" })}>Every setting · {fields}</Link>
          ) : null}
          <Link href={page.href} className={buttonVariants({ variant: "highlight" })}>Open {page.title} ›</Link>
        </>}
      />
      <DocsFrame fit menu={<DocsMenuStreamed state={state} activeSettings={page.slug} />}>
        <SettingsDoc page={page} moves={moves} view={view} />
      </DocsFrame>
    </div>
  );
}
