import Link from "next/link";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Circle } from "lucide-react";

import { Suspense } from "react";

import { DocsMenuStreamed, DocsSearchStreamed, type DocsState } from "@/components/app/docs/docs-streamed";
import { DocsFrame } from "@/components/app/docs/docs-shell";
import { ShotStepper } from "@/components/app/docs/shot-stepper";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection } from "@/components/ui/stream-section";
import { shotLabel } from "@/lib/dashboard/guideMoves";
import { allDocPages } from "@/lib/docs/content";
import { DOC_MODULES } from "@/lib/docs/modules";
import { stepLabel, taskMoves, taskWhy } from "@/lib/docs/shotsFor";
import { loadDocsState } from "@/lib/docs/state";
import type { DocTask } from "@/lib/docs/tasks";
import { docWheres } from "@/lib/docs/where";

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/** A guide link that remembers it came from Docs, so Done offers "Back to Docs": `&from=docs` before any `#tab`. */
function fromDocs(href: string): string {
  const [before, hash] = href.split("#", 2);
  return `${before}${before.includes("?") ? "&" : "?"}from=docs${hash ? `#${hash}` : ""}`;
}

export function referencePages() {
  return allDocPages().filter((page) => page.chapter !== "setup").map((page) => ({ slug: page.slug, title: page.title, chapter: page.chapter }));
}

/**
 * A Docs task, R7 (owner 2026-11-17: the side cards "take a lot of space… keep everything within the height of the
 * page… the why… like an informational icon"). One slim line on top: what you'll need first, whether your agency
 * has done it, and the previous and next task. Then the clicks, Back and Next on either side of them, and the real
 * screen filling the rest of the page. Why it matters is in the title's (i), with how long it takes.
 */
export function TaskPage({ task }: { task: DocTask }) {
  // Frame first (UI-CONSISTENCY §7a): the title, search, menu frame and the task's own button draw at once; whether
  // your agency has done it (and its guide) streams in from one started read.
  const docs = loadDocsState();
  const guide = DOC_MODULES.find((item) => item.key === task.module);
  const moves = taskMoves(task);
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title={task.title}
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, ...(guide ? [{ label: guide.title, href: `/app/docs/modules/${guide.key}` }] : []), { label: task.title }]}
        description={`${taskWhy(task)} · ${moves.length} steps, about ${task.minutes} min.`}
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={docs} /></div>}
        actions={<Suspense fallback={<Link href={task.open.href} className={buttonVariants({ variant: "highlight" })}>{task.open.label} ›</Link>}><TaskOpen task={task} docs={docs} /></Suspense>}
      />
      <DocsFrame fit menu={<DocsMenuStreamed state={docs} activeSlug={task.slug} activeModule={task.module} />}>
        <StreamSection shape="cards" cards={1} rows={6}><TaskBody task={task} docs={docs} /></StreamSection>
      </DocsFrame>
    </div>
  );
}

/** The title line's button: "Do it in Insurvas" while this reader's setup step is open, else the task's own page. */
async function TaskOpen({ task, docs }: { task: DocTask; docs: DocsState }) {
  const { viewer, tasks } = await docs;
  if (tasks.get(task.slug)?.offPlan) return null;
  const step = task.setupStep ? viewer.steps.get(task.setupStep) : undefined;
  return step && !step.complete
    ? <Link href={fromDocs(step.href)} className={buttonVariants({ variant: "highlight" })}>Do it in Insurvas · it shows every click ›</Link>
    : <Link href={task.open.href} className={buttonVariants({ variant: "highlight" })}>{task.open.label} ›</Link>;
}

async function TaskBody({ task, docs }: { task: DocTask; docs: DocsState }) {
  const { viewer, modules, tasks } = await docs;
  const state = tasks.get(task.slug);
  const step = task.setupStep ? viewer.steps.get(task.setupStep) : undefined;
  const moves = taskMoves(task);
  // Where each step happens, for its Explain panel: the task's page, or the page a step moves to (`at`), carried on.
  const wheres = docWheres(step?.path ?? task.open.href, moves.map((_, index) => task.steps?.[index]?.at), task.open.label);

  const needs = (task.needs ?? [])
    .map((slug) => tasks.get(slug))
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && !item!.offPlan)
    .map((item) => ({ slug: item.task.slug, title: item.task.title, done: item.done !== false }));
  const firstMissing = needs.find((need) => !need.done);

  // Previous and next in the menu's order: modules in turn, each module's tasks in turn.
  const order = modules.flatMap((entry) => entry.tasks.map((item) => item.task));
  const at = order.findIndex((item) => item.slug === task.slug);
  const previous = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;

  // Whether your agency has done it, as one chip; what Insurvas checks to tick it is its tooltip.
  const status = state?.offPlan
    ? <StatusChip tone="neutral">Not on your plan</StatusChip>
    : state?.done === true
      ? <span title={task.whenDone} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink)]"><CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />Done in your agency</span>
      : state?.done === false
        ? <span title={`Insurvas ticks this once it sees it done: ${task.whenDone}`} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)]"><Circle aria-hidden="true" className="size-3.5" />Not done yet</span>
        : null;

  const pagerLink = "inline-flex min-w-0 max-w-[220px] items-center gap-1 text-sm text-[var(--muted)] no-underline hover:text-[var(--ink)] hover:underline";

  return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section aria-label="Before you start" className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2`}>
            <h2 className="m-0 text-xs font-semibold text-[var(--muted)]">You&apos;ll need first</h2>
            {needs.length === 0 ? <span className="text-sm text-[var(--muted)]">Nothing</span> : needs.map((need) => (
              <Link key={need.slug} href={`/app/docs/${need.slug}`} className={`flex items-center gap-1.5 text-sm no-underline hover:underline ${need.done ? "text-[var(--ink)]" : "text-[var(--body)]"}`}>
                {need.done ? <Check aria-label="Done" className="size-4 text-[var(--success)]" strokeWidth={3} /> : <Circle aria-label="Not done yet" className="size-3.5 text-[var(--muted)]" />}
                {need.title}
              </Link>
            ))}
            {firstMissing ? <Link href={`/app/docs/${firstMissing.slug}`} className={buttonVariants({ size: "sm" })}>Show me: {firstMissing.title} ›</Link> : null}
            <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />
            {status}
            {step?.complete ? <Link href={fromDocs(step.href)} className="text-sm font-medium text-[var(--accent-ink)] no-underline hover:underline">Guide me again</Link> : null}
            <span className="flex-1" />
            <nav aria-label="More tasks" className="flex items-center gap-4">
              {previous
                ? <Link href={`/app/docs/${previous.slug}`} className={pagerLink} title={previous.title}><ChevronLeft aria-hidden="true" className="size-4 shrink-0" /><span className="truncate">{previous.title}</span></Link>
                : <Link href="/app/docs" className={pagerLink}><ChevronLeft aria-hidden="true" className="size-4 shrink-0" />Docs home</Link>}
              {next ? <Link href={`/app/docs/${next.slug}`} className={pagerLink} title={next.title}><span className="truncate">{next.title}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0" /></Link> : null}
            </nav>
          </section>
          <ShotStepper moves={moves.map((move, index) => ({ say: move.say, ...(move.detail ? { detail: move.detail } : {}), photo: move.photo, ...(move.sketch ? { sketch: move.sketch } : {}), label: task.setupStep ? shotLabel(move.say) : stepLabel(move.say), where: wheres[index] ?? null }))} />
        </div>
  );
}
