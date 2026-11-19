import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DocsFrame } from "@/components/app/docs/docs-shell";
import { DocsMenuStreamed, DocsSearchStreamed, type DocsState } from "@/components/app/docs/docs-streamed";
import { DocSteps, type DocStepState } from "@/components/app/docs/doc-steps";
import { ShotStepper } from "@/components/app/docs/shot-stepper";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StreamSection } from "@/components/ui/stream-section";
import { setupStepDefinitions } from "@/lib/dashboard/checklist";
import { guideMovesFor, shotLabel } from "@/lib/dashboard/guideMoves";
import { allDocPages, DOC_CHAPTERS } from "@/lib/docs/content";
import { DOC_SHOTS } from "@/lib/docs/shots";
import { loadDocsState } from "@/lib/docs/state";
import { docTask } from "@/lib/docs/tasks";

import { TaskPage } from "./task-page";

/** A guide link that remembers it came from Docs, so Done offers "Back to Docs": `&from=docs` before any `#tab`. */
function fromDocs(href: string): string {
  const [before, hash] = href.split("#", 2);
  return `${before}${before.includes("?") ? "&" : "?"}from=docs${hash ? `#${hash}` : ""}`;
}

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * One Docs page, R4 (owner 2026-11-13). The search sits in the middle of the page's title line. Below, the menu,
 * then the page. R5 (owner 2026-11-16: "a better step one, step two, step three… remove the costs"): a setup step is
 * its clicks as numbered steps across the top, the chosen click's real screenshot large, and beside it what to do,
 * whether your agency has done it, why it matters, key terms and the next page. Any other page is its steps as
 * numbered cards (each with the screens of the Insurvas step it names), with progress and its figures beside them.
 */
export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const task = docTask(slug);
  if (task) return <TaskPage task={task} />;
  return <ReferencePage slug={slug} />;
}

type DocPage = ReturnType<typeof allDocPages>[number];

/**
 * A reference page (the insurance background): its steps as cards, with progress beside them. Frame first
 * (UI-CONSISTENCY §7a): the title, search, menu frame and a setup page's clicks are fixed text and draw at once; what
 * the reader's agency has done streams in.
 */
function ReferencePage({ slug }: { slug: string }) {
  const pages = allDocPages();
  const index = pages.findIndex((item) => item.slug === slug);
  if (index < 0) notFound();
  const doc = pages[index];
  const docs = loadDocsState();
  const chapter = DOC_CHAPTERS.find((item) => item.key === doc.chapter);
  const isSetup = doc.chapter === "setup";
  const definition = isSetup ? setupStepDefinitions().find((item) => item.key === doc.stepKey) : undefined;
  const moves = definition ? guideMovesFor(definition) : [];
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title={doc.title}
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, ...(chapter ? [{ label: chapter.title }] : []), { label: doc.title }]}
        description={doc.summary}
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={docs} /></div>}
        actions={isSetup ? <Suspense fallback={null}><SetupAction doc={doc} docs={docs} /></Suspense> : null}
      />
      <DocsFrame fit={isSetup} menu={<DocsMenuStreamed state={docs} activeSlug={doc.slug} />}>
        {isSetup ? (
          // A setup page that has no Docs task of its own: just its clicks, filling the page (owner 2026-11-17).
          <ShotStepper moves={moves.map((move, at) => ({ say: move.say, detail: move.detail, photo: DOC_SHOTS[definition?.key ?? ""]?.[at] ?? null, sketch: move.shot, label: shotLabel(move.say) }))} />
        ) : (
          <StreamSection shape="cards" cards={2}><ReferenceBody doc={doc} pages={pages} index={index} docs={docs} /></StreamSection>
        )}
      </DocsFrame>
    </div>
  );
}

/** A setup page's button: "Do it in Insurvas" while the reader's step is open, "Open it" once done. */
async function SetupAction({ doc, docs }: { doc: DocPage; docs: DocsState }) {
  const { viewer } = await docs;
  const step = doc.stepKey ? viewer.steps.get(doc.stepKey) : undefined;
  if (!step) return null;
  return step.complete
    ? <Link href={step.path} className={buttonVariants({ variant: "outline" })}>Open it ›</Link>
    : <Link href={fromDocs(step.href)} className={buttonVariants({ variant: "highlight" })}>Do it in Insurvas ›</Link>;
}

async function ReferenceBody({ doc, pages, index, docs }: { doc: DocPage; pages: DocPage[]; index: number; docs: DocsState }) {
  const { viewer } = await docs;
  const previous = index > 0 ? pages[index - 1] : null;
  const next = index < pages.length - 1 ? pages[index + 1] : null;
  const readyDone = viewer.ready.total > 0 && viewer.ready.done === viewer.ready.total;

  // What Insurvas knows of each how-to step: done in the agency, where its button goes, the page that explains it,
  // and the real screens of its Get set up step (owner 2026-11-16: "screenshots to each step").
  const titleOf = new Map(pages.map((item) => [item.slug, item.title]));
  const firstShot = (key: string) => DOC_SHOTS[key]?.find((shot) => shot !== null) ?? undefined;
  const agency: Record<number, DocStepState> = {};
  (doc.steps ?? []).forEach((item, at) => {
    const done = item.doneWhen === "ready" ? readyDone : item.doneWhen ? viewer.done.has(item.doneWhen) : false;
    const target = item.action?.step ? viewer.steps.get(item.action.step) : undefined;
    const href = item.action?.step ? (target ? fromDocs(target.href) : undefined) : item.action?.href;
    const setupKey = item.action?.step ?? (item.doneWhen && item.doneWhen !== "ready" ? item.doneWhen : undefined);
    const photos = setupKey ? (DOC_SHOTS[setupKey] ?? []).filter((shot) => shot !== null) : [];
    const read = item.read && item.read !== doc.slug ? titleOf.get(item.read) : undefined;
    const state: DocStepState = {
      ...(item.doneWhen || item.action ? { done } : {}),
      ...(href ? { href } : {}),
      ...(item.read && read ? { read: { href: `/app/docs/${item.read}`, title: read } } : {}),
      ...(setupKey && photos.length > 0 ? { shots: { href: `/app/docs/${setupKey}`, title: titleOf.get(setupKey) ?? "the screens", items: photos.map((shot) => ({ src: shot.src, say: shot.alt, ...(shot.focus ? { focus: shot.focus } : {}) })) } } : {}),
      ...(item.doneWhen === "ready" ? {
        // "Set up Insurvas": every Ready to sell step as a tile, its first real screen, ticked when done.
        tiles: (viewer.steps.size > 0
          ? [...viewer.steps.values()].filter((entry) => !entry.optional).map((entry) => ({ key: entry.key, label: entry.label, done: entry.complete }))
          : setupStepDefinitions().filter((entry) => DOC_SHOTS[entry.key]).map((entry) => ({ key: entry.key, label: entry.label, done: false }))
        ).map((entry) => ({ ...entry, href: `/app/docs/${entry.key}`, src: firstShot(entry.key)?.src, focus: firstShot(entry.key)?.focus })),
      } : {}),
    };
    if (Object.keys(state).length > 0) agency[at] = state;
  });

  // The previous and next pages, two links at the foot of the side column: where the reader goes after this.
  const pageLink = `${card} flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5 no-underline hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]`;
  const pager = (
    <nav aria-label="More docs" className="grid grid-cols-2 gap-2">
      <Link href={previous ? `/app/docs/${previous.slug}` : "/app/docs"} className={pageLink}>
        <span className="text-xs text-[var(--muted)]">‹ Previous</span>
        <span className="line-clamp-2 text-sm font-semibold text-[var(--ink)]">{previous ? previous.title : "Start here"}</span>
      </Link>
      {next ? (
        <Link href={`/app/docs/${next.slug}`} className={`${pageLink} items-end text-right`}>
          <span className="text-xs text-[var(--muted)]">Next ›</span>
          <span className="line-clamp-2 text-sm font-semibold text-[var(--ink)]">{next.title}</span>
        </Link>
      ) : <span />}
    </nav>
  );
  const terms = doc.terms ? (
    <section id="terms" className={`${card} scroll-mt-24 px-4 py-3.5`}>
      <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Key terms</h2>
      <dl className="m-0 mt-1.5 flex flex-col gap-2 text-sm">
        {doc.terms.map(([term, meaning]) => (
          <div key={term}><dt className="font-medium text-[var(--ink)]">{term}</dt><dd className="m-0 text-[var(--muted)]">{meaning}</dd></div>
        ))}
      </dl>
    </section>
  ) : null;

  return doc.steps
    ? <DocSteps slug={doc.slug} steps={doc.steps} agency={agency} facts={doc.facts} before={doc.before} aside={<>{terms}{pager}</>} />
    : <div className="flex flex-col gap-4">{terms}{pager}</div>;
}
