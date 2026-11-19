import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/** One module as the map draws it: its box, its top tasks with whether your agency has done each. */
export type MapModule = {
  key: string;
  title: string;
  verb: string;
  covers: string;
  relation?: string;
  lane: "main" | "under" | "beside";
  tasks: { slug: string; title: string; done: boolean }[];
  done: number;
  total: number;
};

const box = "rounded-[14px] border bg-[var(--color-card)] no-underline transition-colors hover:border-[color-mix(in_srgb,var(--primary)_55%,var(--border))]";

function TaskLines({ tasks, max }: { tasks: MapModule["tasks"]; max: number }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {tasks.slice(0, max).map((task) => (
        <li key={task.slug} className="min-w-0">
          <Link href={`/app/docs/${task.slug}`} className={cn("flex min-w-0 items-center gap-1.5 text-xs no-underline hover:underline", task.done ? "text-[var(--ink)]" : "text-[var(--muted)]")}>
            {task.done
              ? <Check aria-label="Done in your agency" className="size-3.5 shrink-0 text-[var(--success)]" strokeWidth={3} />
              : <Circle aria-label="Not done yet" className="size-3 shrink-0" />}
            <span className="truncate">{task.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Count({ module }: { module: MapModule }) {
  if (module.total === 0) return null;
  if (module.done === module.total) return <StatusChip tone="good">{module.done} of {module.total}</StatusChip>;
  if (module.done === 0) return <StatusChip tone="neutral">Not used yet</StatusChip>;
  return <StatusChip tone="neutral">{module.done} of {module.total}</StatusChip>;
}

/**
 * Docs home, R6 board B (owner 2026-11-16: "Lead to money seems the best… the full height should be filled"): the
 * map of how a lead becomes money fills the page. Six modules on the line, each a box with its guide link, its top
 * "How do I…" tasks ticked when your agency has done them, and its count; three under the line; the rest beside.
 */
export function DocsMap({ modules, next }: { modules: MapModule[]; next: { href: string; title: string; module: string } | null }) {
  const main = modules.filter((item) => item.lane === "main");
  const under = modules.filter((item) => item.lane === "under");
  const beside = modules.filter((item) => item.lane === "beside");
  return (
    <section aria-label="How Insurvas turns a lead into money" className="flex min-h-0 flex-1 flex-col gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">How Insurvas turns a lead into money</h2>
        <span className="text-xs text-[var(--muted)]">Open a module for how it works, or a task for its steps · ✓ done in your agency</span>
      </div>

      <ol className="m-0 grid min-h-0 flex-[1.4] list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-6">
        {main.map((module, index) => (
          <li key={module.key} className="relative flex min-w-0">
            <div className={cn(box, "flex min-h-[180px] w-full flex-col gap-1 border-[var(--border)] p-3", next?.module === module.key && "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[var(--primary-soft)]")}>
              <Link href={`/app/docs/modules/${module.key}`} className="flex flex-col gap-0.5 no-underline">
                <span className="text-xs text-[var(--muted)] tabular-nums">{index + 1} · {module.title}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{module.verb}</span>
                <span className="text-xs text-[var(--muted)]">{module.covers}</span>
              </Link>
              <span className="flex-1" />
              <TaskLines tasks={module.tasks} max={4} />
              <span className="mt-1.5"><Count module={module} /></span>
            </div>
            {index < main.length - 1 ? <ArrowRight aria-hidden="true" className="absolute top-1/2 -right-2.5 z-[1] hidden size-4 -translate-y-1/2 text-[var(--muted)] xl:block" /> : null}
          </li>
        ))}
      </ol>

      <ul className="m-0 grid min-h-0 flex-1 list-none grid-cols-1 gap-2 p-0 md:grid-cols-3">
        {under.map((module) => (
          <li key={module.key} className="flex min-w-0">
            <div className={cn(box, "flex min-h-[120px] w-full flex-col gap-1 border-dashed border-[var(--border)] p-3")}>
              <Link href={`/app/docs/modules/${module.key}`} className="flex flex-col gap-0.5 no-underline">
                <span className="text-xs text-[var(--muted)]">{module.relation}</span>
                <span className="text-sm font-semibold text-[var(--ink)]">{module.title}</span>
                <span className="text-xs text-[var(--muted)]">{module.covers}</span>
              </Link>
              <span className="flex-1" />
              <div className="flex flex-wrap items-end justify-between gap-2"><TaskLines tasks={module.tasks} max={3} /><Count module={module} /></div>
            </div>
          </li>
        ))}
      </ul>

      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-4">
        {beside.map((module) => (
          <li key={module.key} className="min-w-0">
            <Link href={`/app/docs/modules/${module.key}`} className={cn(box, "flex items-center gap-2 border-[var(--border)] px-3 py-2.5")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--ink)]">{module.title}</span>
                <span className="block truncate text-xs text-[var(--muted)]">{module.covers}</span>
              </span>
              <Count module={module} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The strip over the map: one bar split by module, each segment filled by how much of that module you've done. */
export function DocsProgressStrip({ modules }: { modules: MapModule[] }) {
  const counted = modules.filter((item) => item.total > 0);
  const done = counted.reduce((sum, item) => sum + item.done, 0);
  const total = counted.reduce((sum, item) => sum + item.total, 0);
  return (
    <section aria-label="Your Insurvas" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-[var(--border)] bg-[var(--color-card)] px-4 py-3">
      <h2 className="m-0 text-sm font-semibold whitespace-nowrap text-[var(--ink)]">Your Insurvas</h2>
      <SegmentBar modules={counted} className="min-w-[240px] flex-1" labels />
      <StatusChip tone={done === total ? "good" : "neutral"}>{done} of {total} tasks done in your agency</StatusChip>
    </section>
  );
}

/** One bar, one segment per module, each filled by its share done; labels under it on wide screens. */
export function SegmentBar({ modules, className, labels = false }: { modules: Pick<MapModule, "key" | "title" | "done" | "total">[]; className?: string; labels?: boolean }) {
  const done = modules.reduce((sum, item) => sum + item.done, 0);
  const total = modules.reduce((sum, item) => sum + item.total, 0);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div role="img" aria-label={`${done} of ${total} tasks done in your agency`} className="flex h-2 gap-[3px]">
        {modules.map((item) => (
          <span key={item.key} title={`${item.title}: ${item.done} of ${item.total}`} className="relative flex-1 overflow-hidden rounded-full bg-[var(--border)]">
            <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--primary)]" style={{ width: `${item.total ? (item.done / item.total) * 100 : 0}%` }} />
          </span>
        ))}
      </div>
      {labels ? (
        <div aria-hidden="true" className="hidden gap-[3px] lg:flex">
          {modules.map((item) => <span key={item.key} className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{item.title}</span>)}
        </div>
      ) : null}
    </div>
  );
}
