"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import type { DocStep } from "@/lib/docs/content";

import { DocThumbImage, type DocFocus } from "./doc-thumb";
import { toggleStep, useTickedSteps } from "./docs-reading";

export type { DocFocus };

/** A screenshot of one click, as a step's strip shows it. */
export type DocThumb = { src: string; say: string; focus?: DocFocus };

/**
 * What Insurvas knows of a step: done in the agency, where its button goes, the page that explains it, the
 * screens of its Get set up step (each click), or, for "Set up Insurvas", every Ready to sell step as a tile.
 */
export type DocStepState = {
  done?: boolean;
  href?: string;
  read?: { href: string; title: string };
  shots?: { href: string; title: string; items: DocThumb[] };
  tiles?: { key: string; label: string; href: string; src?: string; focus?: DocFocus; done: boolean }[];
};

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

const Thumb = DocThumbImage;

/**
 * A how-to page, step by step (R5, owner 2026-11-16: "a better step one, step two, step three… way better
 * rearrangement", "screenshots to each step", no costs). Each step is its own card on a numbered line: Step n and
 * its time, what to do, and its one button while it's the current step. A step done in Insurvas shows the real
 * screens of each click; "Set up Insurvas" shows every Ready to sell step. Beside the steps: progress, the page's
 * figures, "before you start", then `aside` (key terms, the next page).
 */
export function DocSteps({ slug, steps, agency, facts, before, aside }: {
  slug: string;
  steps: DocStep[];
  agency: Record<number, DocStepState>;
  facts?: { label: string; value: string }[];
  before?: string;
  aside?: ReactNode;
}) {
  const ticked = useTickedSteps(slug);
  const isDone = (index: number) => agency[index]?.done === true || ticked.has(index);
  const doneCount = steps.filter((_, index) => isDone(index)).length;
  const current = steps.findIndex((_, index) => !isDone(index));

  return (
    <div className="grid min-h-0 flex-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <ol className="m-0 flex min-w-0 list-none flex-col p-0">
        {steps.map((step, index) => {
          const known = agency[index];
          const done = isDone(index);
          const state = done ? "done" : index === current ? "current" : "todo";
          const href = known?.href ?? step.action?.href;
          const last = index === steps.length - 1;
          // Several steps explained by one page link it once, on the first of them.
          const read = known?.read && known.read.href !== agency[index - 1]?.read?.href ? known.read : undefined;
          return (
            <li key={index} className="flex flex-col">
              {step.phase ? (
                <h2 className={cn("m-0 pb-2 pl-[56px] text-xs font-semibold text-[var(--accent-ink)]", index > 0 && "pt-3")}>{step.phase}</h2>
              ) : null}
              <div className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 pb-3">
                {!last ? <span aria-hidden="true" className={cn("absolute top-[44px] bottom-0 left-[19px] w-0.5", done ? "bg-[var(--primary)]" : "bg-[var(--border)]")} /> : null}
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-[1] mt-3 inline-flex size-10 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums",
                    state === "done" && "border-transparent bg-[var(--success-surface,var(--primary-soft))] text-[var(--success)]",
                    state === "current" && "border-[var(--primary)] bg-[var(--color-card)] text-[var(--accent-ink)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
                    state === "todo" && "border-[var(--border)] bg-[var(--color-card)] text-[var(--muted)]",
                  )}
                >
                  {done ? <Check className="size-4" strokeWidth={3} /> : index + 1}
                </span>
                <article className={cn(card, "flex min-w-0 flex-col gap-3 px-4 py-3.5", state === "current" && "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))]")}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-xs text-[var(--muted)] tabular-nums">
                        <span className="sr-only">{done ? "Done: " : state === "current" ? "Now: " : ""}</span>
                        Step {index + 1}{step.time ? ` · ${step.time}` : ""}
                      </p>
                      <h3 className="m-0 mt-0.5 text-sm font-semibold text-[var(--ink)]">{step.title}</h3>
                      <p className="m-0 mt-0.5 text-sm text-[var(--muted)]">{step.detail}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {known?.done ? (
                        <StatusChip tone="good">Done in your agency</StatusChip>
                      ) : done ? (
                        <button type="button" onClick={() => toggleStep(slug, index)} className="cursor-pointer border-0 bg-transparent p-0" title="Undo"><StatusChip tone="good">Done</StatusChip></button>
                      ) : state === "current" ? (
                        <>
                          {step.doneWhen ? null : <Button type="button" variant="outline" size="sm" onClick={() => toggleStep(slug, index)}>Mark done</Button>}
                          {step.action && href ? <Link href={href} className={buttonVariants({ variant: step.action.step ? "highlight" : "default", size: "sm" })}>{step.action.label} ›</Link> : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {known?.shots && known.shots.items.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <ol className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 2xl:grid-cols-5">
                        {known.shots.items.map((shot, at) => (
                          <li key={shot.src} className="min-w-0">
                            <Link href={`${known.shots!.href}?click=${at + 1}`} className="group flex flex-col gap-1.5 no-underline">
                              <Thumb src={shot.src} alt={shot.say} focus={shot.focus} />
                              <span className="flex min-w-0 gap-1.5 text-xs text-[var(--muted)] group-hover:text-[var(--ink)]">
                                <span className="font-semibold tabular-nums text-[var(--ink)]">{at + 1}</span>
                                <span className="line-clamp-2">{shot.say}</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {known?.tiles && known.tiles.length > 0 ? (
                    <ol className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 2xl:grid-cols-5">
                      {known.tiles.map((tile, at) => (
                        <li key={tile.key} className="min-w-0">
                          <Link href={tile.href} className="group flex flex-col gap-1.5 no-underline">
                            <span className="relative block">
                              <Thumb src={tile.src} alt={tile.label} focus={tile.focus} />
                              {tile.done ? (
                                <span className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-[var(--success)] text-[var(--color-card)]"><Check aria-label="Done" className="size-3.5" strokeWidth={3} /></span>
                              ) : null}
                            </span>
                            <span className="flex min-w-0 gap-1.5 text-xs text-[var(--muted)] group-hover:text-[var(--ink)]">
                              <span className="font-semibold tabular-nums text-[var(--ink)]">{at + 1}</span>
                              <span className="line-clamp-2">{tile.label}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  {read || known?.shots ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2.5 text-xs">
                      {known?.shots ? <Link href={known.shots.href} className="font-semibold text-[var(--accent-ink)] no-underline hover:underline">Every click: {known.shots.title} ›</Link> : null}
                      {read ? <Link href={read.href} className="font-semibold text-[var(--accent-ink)] no-underline hover:underline">Read: {read.title} ›</Link> : null}
                    </div>
                  ) : null}
                </article>
              </div>
            </li>
          );
        })}
      </ol>

      <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4">
        <section className={cn(card, "flex flex-col gap-2 px-4 py-3.5")}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Your progress</h2>
            <span className="text-xs text-[var(--muted)] tabular-nums">{doneCount} of {steps.length} done</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Steps done">
            <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-500" style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} />
          </div>
          {facts && facts.length > 0 ? (
            <dl className="m-0 mt-1 flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5 text-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--muted)]">{fact.label}</dt>
                  <dd className="m-0 text-right font-semibold tabular-nums text-[var(--ink)]">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
        {before ? (
          <section className={cn(card, "px-4 py-3.5")}>
            <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Before you start</h2>
            <p className="m-0 mt-1 text-sm text-[var(--muted)]">{before}</p>
          </section>
        ) : null}
        {aside}
      </aside>
    </div>
  );
}
