import Link from "next/link";

import { Button } from "@/components/ui/button";

/** One kind of decision a file left: its words, how many, and its Review page (null: nothing to decide here). */
export type WaitingPart = { label: string; count: number; href: string | null };

const n = (value: number) => value.toLocaleString("en-US");

/**
 * What a file waits on (round 5, owner 2026-11-03: the file page shows, it never decides). One line: the figure,
 * what it is made of (each part a link to its own Review queue), and one button into the Review page, where the
 * questions are answered one at a time or in bulk. Status words wait on Insurvas, so they're named but not linked.
 */
export function FileWaiting({ total, parts, reviewHref, reviewCount }: { total: number; parts: WaitingPart[]; reviewHref: string | null; reviewCount: number }) {
  if (!parts.length) return null;
  return (
    <section aria-label="Waiting on you" data-slot="card" className="m-glass flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-3">
      <span className="text-2xl font-bold tabular-nums text-[var(--warning-ink)]">{n(total)}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">Waiting on you before this file is done</span>
        <span className="block text-sm text-muted-foreground">
          {parts.map((part, index) => (
            <span key={part.label}>
              {index > 0 && " · "}
              {part.href ? <Link href={part.href} className="hover:text-foreground hover:underline">{n(part.count)} {part.label}</Link> : <span title="Waiting on Insurvas to map it">{n(part.count)} {part.label}</span>}
            </span>
          ))}
        </span>
      </span>
      {reviewHref && <Button asChild><Link href={reviewHref}>Review {n(reviewCount)} →</Link></Button>}
    </section>
  );
}
