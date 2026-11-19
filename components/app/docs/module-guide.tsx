"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";

import { DocThumbImage, type DocFocus } from "./doc-thumb";

export type GuideTask = { slug: string; title: string; minutes: number; done: boolean; steps: number; blocked?: string; shot?: { src: string; alt: string; focus?: DocFocus } };

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * A module's guide, R6 template A (owner 2026-11-16: "I really like the how, why, and for you… and you'll need first
 * … perfect. Also, the screenshot part is a real help"). The promise; how it works as boxes; three cards (why we
 * built it, what it does for you by role, what you'll need first); the first three clicks on real screens; then
 * every task in the module with whether your agency has done it.
 */
export function ModuleGuide({ promise, how, why, forYou, needs, firstClicks, tasks }: {
  promise: string;
  how: { title: string; detail: string }[];
  why: string[];
  forYou: { role: string; text: string[] }[];
  needs: { label: string; href: string; done: boolean }[];
  firstClicks: { href: string; say: string; src: string; focus?: DocFocus }[];
  tasks: GuideTask[];
}) {
  const [role, setRole] = useState(0);
  const current = forYou[role] ?? forYou[0];
  const done = tasks.filter((task) => task.done).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="m-0 text-base font-medium text-[var(--ink)]">{promise}</p>

      <section className={cn(card, "px-4 py-3.5")}>
        <h2 className="m-0 mb-2.5 text-xs font-semibold text-[var(--muted)]">How it works</h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none">
          {how.map((node, index) => (
            <li key={node.title} className="relative flex min-w-0">
              <div className="flex w-full flex-col gap-0.5 rounded-[12px] border border-[var(--border)] px-3 py-2.5">
                <span className="text-xs text-[var(--muted)] tabular-nums">{index + 1}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{node.title}</span>
                <span className="text-xs text-[var(--muted)]">{node.detail}</span>
              </div>
              {index < how.length - 1 ? <ArrowRight aria-hidden="true" className="absolute top-1/2 -right-2.5 z-[1] hidden size-4 -translate-y-1/2 text-[var(--muted)] xl:block" /> : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cn(card, "px-4 py-3.5")}>
          <h2 className="m-0 mb-1.5 text-xs font-semibold text-[var(--accent-ink)]">Why we built it</h2>
          <ul className="m-0 flex flex-col gap-1.5 pl-4 text-sm text-[var(--body)]">{why.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section className={cn(card, "px-4 py-3.5")}>
          <h2 className="m-0 mb-1.5 text-xs font-semibold text-[var(--accent-ink)]">What it does for you</h2>
          {forYou.length > 1 ? (
            <div aria-label="Your role" className="mb-2 flex flex-wrap gap-1.5">
              {forYou.map((item, index) => (
                <ToggleChip key={item.role} selected={index === role} onClick={() => setRole(index)}>{item.role}</ToggleChip>
              ))}
            </div>
          ) : <p className="m-0 mb-1 text-xs text-[var(--muted)]">{current?.role}</p>}
          <ul className="m-0 flex flex-col gap-1.5 pl-4 text-sm text-[var(--body)]">{current?.text.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
        <section className={cn(card, "px-4 py-3.5")}>
          <h2 className="m-0 mb-1.5 text-xs font-semibold text-[var(--accent-ink)]">You&apos;ll need first</h2>
          {needs.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">Nothing: you can start here.</p> : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {needs.map((need) => (
                <li key={need.label}>
                  <Link href={need.href} className={cn("flex items-center gap-2 text-sm no-underline hover:underline", need.done ? "text-[var(--ink)]" : "text-[var(--body)]")}>
                    {need.done ? <Check aria-label="Done" className="size-4 shrink-0 text-[var(--success)]" strokeWidth={3} /> : <Circle aria-label="Not done yet" className="size-3.5 shrink-0 text-[var(--muted)]" />}
                    {need.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {firstClicks.length > 0 ? (
        <section className={cn(card, "px-4 py-3.5")}>
          <div className="mb-2.5 flex items-baseline gap-2"><h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Your first clicks</h2><span className="text-xs text-[var(--muted)]">Real screens · open one for every step</span></div>
          <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
            {firstClicks.map((click, index) => (
              <li key={click.src + index} className="min-w-0">
                <Link href={click.href} className="group flex flex-col gap-1.5 no-underline">
                  <DocThumbImage src={click.src} alt={click.say} focus={click.focus} />
                  <span className="flex gap-1.5 text-xs text-[var(--muted)] group-hover:text-[var(--ink)]"><span className="font-semibold text-[var(--ink)] tabular-nums">{index + 1}</span><span className="line-clamp-2">{click.say}</span></span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={cn(card, "px-4 py-3.5")}>
        <div className="mb-1 flex items-baseline gap-2"><h2 className="m-0 text-sm font-semibold text-[var(--ink)]">How do I…</h2><span className="text-xs text-[var(--muted)] tabular-nums">{done} of {tasks.length} done in your agency</span></div>
        <ul className="m-0 flex list-none flex-col p-0">
          {tasks.map((task) => (
            <li key={task.slug} className="border-t border-[var(--border)] first:border-t-0">
              <Link href={`/app/docs/${task.slug}`} className="flex items-center gap-3 py-2.5 no-underline">
                {task.done ? <Check aria-label="Done in your agency" className="size-4 shrink-0 text-[var(--success)]" strokeWidth={3} /> : <Circle aria-label="Not done yet" className="size-3.5 shrink-0 text-[var(--muted)]" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">{task.title}</span>
                {task.blocked ? <StatusChip tone="warning">{task.blocked}</StatusChip> : null}
                <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">{task.steps} steps · {task.minutes} min</span>
                <span className={buttonVariants({ variant: "ghost", size: "sm" })}>Show me ›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
