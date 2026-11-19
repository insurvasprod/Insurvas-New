import Link from "next/link";
import { notFound } from "next/navigation";

import { DocsMenuStreamed, DocsSearchStreamed, type DocsState } from "@/components/app/docs/docs-streamed";
import { DocsFrame } from "@/components/app/docs/docs-shell";
import { ModuleGuide } from "@/components/app/docs/module-guide";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StreamSection } from "@/components/ui/stream-section";
import { docModule } from "@/lib/docs/modules";
import { firstShot, taskStepCount } from "@/lib/docs/shotsFor";
import { loadDocsState } from "@/lib/docs/state";

/**
 * A module's guide, R6 template A (owner 2026-11-16): how it works, why we built it, what it does for you, what you
 * need first, the first clicks on real screens, and every "How do I…" task in it, ticked when your agency has done it.
 */
export default async function ModuleGuidePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: key } = await params;
  const guide = docModule(key);
  if (!guide) notFound();
  // Frame first: title, search and menu frame at once; the guide's ticks and "needs first" stream in.
  const state = loadDocsState();
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title={guide.title}
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, { label: guide.title }]}
        description={`${guide.minutes} min read · ${guide.promise}`}
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={state} /></div>}
        actions={<Link href={guide.open.href} className={buttonVariants({ variant: "highlight" })}>{guide.open.label} ›</Link>}
      />
      <DocsFrame menu={<DocsMenuStreamed state={state} activeModule={guide.key} />}>
        <StreamSection shape="cards" cards={2}><ModuleGuideFor guide={guide} state={state} /></StreamSection>
      </DocsFrame>
    </div>
  );
}

async function ModuleGuideFor({ guide, state }: { guide: NonNullable<ReturnType<typeof docModule>>; state: DocsState }) {
  const { modules, tasks } = await state;
  const entry = modules.find((item) => item.module.key === guide.key);
  const own = entry?.tasks ?? [];

  // What the module needs from elsewhere: the other modules' tasks its own tasks wait on.
  const needSlugs = [...new Set(own.flatMap((item) => item.task.needs ?? []))].filter((slug) => tasks.get(slug) && tasks.get(slug)!.task.module !== guide.key && !tasks.get(slug)!.offPlan);
  const needs = needSlugs.slice(0, 5).map((slug) => ({ label: tasks.get(slug)!.task.title, href: `/app/docs/${slug}`, done: tasks.get(slug)!.done === true }));

  const firstClicks = own
    .map((item) => ({ item, shot: firstShot(item.task) }))
    .filter((pair) => pair.shot)
    .slice(0, 3)
    .map(({ item, shot }) => ({ href: `/app/docs/${item.task.slug}`, say: `${item.task.title}: ${shot!.alt}`, src: shot!.src, ...(shot!.focus ? { focus: shot!.focus } : {}) }));

  return (
        <ModuleGuide
          promise={guide.promise}
          how={guide.how}
          why={guide.why}
          forYou={guide.forYou}
          needs={needs}
          firstClicks={firstClicks}
          tasks={own.map((item) => ({
            slug: item.task.slug,
            title: item.task.title,
            minutes: item.task.minutes,
            done: item.done === true,
            steps: taskStepCount(item.task),
            ...((item.task.needs ?? []).some((slug) => tasks.get(slug)?.done === false && !tasks.get(slug)?.offPlan) && item.done !== true ? { blocked: "Needs a step first" } : {}),
          }))}
        />
  );
}
