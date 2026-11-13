import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { DocsFrame, DocVideo } from "@/components/app/docs/docs-shell";
import { DocsMenu } from "@/components/app/docs/docs-menu";
import { DocsSearch } from "@/components/app/docs/docs-search";
import { DocSteps, type DocStepState } from "@/components/app/docs/doc-steps";
import { MoveShot } from "@/components/app/docs/move-shot";
import { buttonVariants } from "@/components/ui/button";
import { FactsStrip, NumberedSteps } from "@/components/ui/numbered-steps";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { setupStepDefinitions } from "@/lib/dashboard/checklist";
import { guideMovesFor, shotLabel } from "@/lib/dashboard/guideMoves";
import { allDocPages, DOC_CHAPTERS, docsMenuPages, docsSearchIndex } from "@/lib/docs/content";
import { loadDocsViewer } from "@/lib/docs/viewer";

/** A guide link that remembers it came from Docs, so Done offers "Back to Docs": `&from=docs` before any `#tab`. */
function fromDocs(href: string): string {
  const [before, hash] = href.split("#", 2);
  return `${before}${before.includes("?") ? "&" : "?"}from=docs${hash ? `#${hash}` : ""}`;
}

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * One Docs page, R4 (owner 2026-11-13). The search sits in the middle of the page's title line. Below, the menu,
 * then two columns that fill the height: on the left Previous and Next above the video, the page's figures and
 * "before you start" (or, for a setup step, why it matters and whether your agency has done it); on the right the
 * page exactly step by step, never paragraphs (a setup step shows every click with a picture of its screen).
 */
export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pages = allDocPages();
  const index = pages.findIndex((item) => item.slug === slug);
  if (index < 0) notFound();
  const doc = pages[index];
  const viewer = await loadDocsViewer();
  const chapter = DOC_CHAPTERS.find((item) => item.key === doc.chapter);
  const step = doc.stepKey ? viewer.steps.get(doc.stepKey) : undefined;
  const previous = index > 0 ? pages[index - 1] : null;
  const next = index < pages.length - 1 ? pages[index + 1] : null;
  const isSetup = doc.chapter === "setup";
  const definition = isSetup ? setupStepDefinitions().find((item) => item.key === doc.stepKey) : undefined;
  const moves = definition ? guideMovesFor(definition) : [];
  const readyDone = viewer.ready.total > 0 && viewer.ready.done === viewer.ready.total;

  // What Insurvas knows of each how-to step: done in the agency, and where its button goes.
  const agency: Record<number, DocStepState> = {};
  (doc.steps ?? []).forEach((item, at) => {
    const done = item.doneWhen === "ready" ? readyDone : item.doneWhen ? viewer.done.has(item.doneWhen) : false;
    const target = item.action?.step ? viewer.steps.get(item.action.step) : undefined;
    const href = item.action?.step ? (target ? fromDocs(target.href) : undefined) : item.action?.href;
    if (item.doneWhen || item.action) agency[at] = { done, ...(href ? { href } : {}) };
  });

  const titleAction = isSetup && step ? (
    step.complete
      ? <Link href={step.path} className={buttonVariants({ variant: "outline" })}>Open it ›</Link>
      : <Link href={fromDocs(step.href)} className={buttonVariants({ variant: "highlight" })}>Do it in Insurvas ›</Link>
  ) : null;

  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title={doc.title}
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, ...(chapter ? [{ label: chapter.title }] : []), { label: doc.title }]}
        description={doc.summary}
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearch entries={docsSearchIndex(viewer.insurvas)} /></div>}
        actions={titleAction}
      />
      <DocsFrame menu={<DocsMenu pages={docsMenuPages()} chapters={DOC_CHAPTERS.map(({ key, title }) => ({ key, title }))} activeSlug={doc.slug} done={[...viewer.done]} />}>
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <nav aria-label="More docs" className="flex flex-wrap items-center gap-2">
              {previous ? <Link href={`/app/docs/${previous.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>‹ {previous.title}</Link> : <Link href="/app/docs" className={buttonVariants({ variant: "outline", size: "sm" })}>‹ Start here</Link>}
              <span className="flex-1" />
              {next ? <Link href={`/app/docs/${next.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Next: {next.title} ›</Link> : null}
            </nav>
            <DocVideo video={doc.video} />
            {doc.facts ? <FactsStrip facts={doc.facts} /> : null}
            {doc.before ? (
              <section className={`${card} px-4 py-3.5`}>
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Before you start</h2>
                <p className="m-0 mt-1 text-sm text-[var(--muted)]">{doc.before}</p>
              </section>
            ) : null}
            {isSetup ? (
              <section className={`${card} px-4 py-3.5`}>
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Why it matters</h2>
                <p className="m-0 mt-1 text-sm text-[var(--muted)]">{doc.summary}</p>
              </section>
            ) : null}
            {isSetup && step ? (
              step.complete ? (
                <section className={`${card} flex flex-wrap items-center gap-3 px-4 py-3.5`}>
                  <CheckCircle2 aria-hidden="true" className="size-6 shrink-0 text-[var(--success)]" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-[var(--ink)]">Done in your agency</p>
                    <p className="m-0 text-xs text-[var(--muted)]">{step.optional ? "Optional setting" : "Part of Ready to sell"} · you can change it any time</p>
                  </div>
                  <Link href={step.path} className={buttonVariants({ variant: "outline", size: "sm" })}>Open it</Link>
                  <Link href={fromDocs(step.href)} className={buttonVariants({ variant: "ghost", size: "sm" })}>Guide me again</Link>
                </section>
              ) : (
                <section className={`${card} flex flex-wrap items-center gap-3 px-4 py-3.5`}>
                  <StatusChip tone="warning">Not done yet</StatusChip>
                  <span className="min-w-0 flex-1 text-sm text-[var(--muted)]">{step.minutes ? `About ${step.minutes} min · ` : ""}{step.optional ? "Optional setting" : "Required for Ready to sell"}</span>
                  <Link href={fromDocs(step.href)} className={buttonVariants()}>Do it in Insurvas ›</Link>
                </section>
              )
            ) : isSetup ? (
              <section className={`${card} flex flex-wrap items-center gap-3 px-4 py-3.5`}>
                <StatusChip tone="neutral">Not on your plan</StatusChip>
                <span className="min-w-0 flex-1 text-sm text-[var(--muted)]">Your plan doesn&apos;t include this step, so there is nothing to set up here.</span>
              </section>
            ) : null}
          </div>
          <section className={`${card} flex min-w-0 flex-col gap-2 px-5 pt-4 pb-4`}>
            {isSetup ? (
              <>
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Each click <span className="font-normal text-[var(--muted)]">· the guide lights these one at a time</span></h2>
                <NumberedSteps steps={moves.map((move, at) => ({ key: String(at), title: move.say, detail: move.detail, children: move.shot ? <MoveShot shot={move.shot} label={shotLabel(move.say)} /> : null }))} />
              </>
            ) : doc.steps ? (
              <>
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Step by step <span className="font-normal text-[var(--muted)]">· in this order</span></h2>
                <DocSteps slug={doc.slug} steps={doc.steps} agency={agency} />
              </>
            ) : null}
            {doc.terms ? (
              <div id="terms" className="mt-auto scroll-mt-24 border-t border-[var(--border)] pt-3">
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Key terms</h2>
                <dl className="m-0 mt-1.5 grid gap-x-5 gap-y-1.5 text-sm sm:grid-cols-[150px_minmax(0,1fr)]">
                  {doc.terms.map(([term, meaning]) => (
                    <div key={term} className="contents"><dt className="font-medium text-[var(--ink)]">{term}</dt><dd className="m-0 text-[var(--muted)]">{meaning}</dd></div>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>
        </div>
      </DocsFrame>
    </div>
  );
}
