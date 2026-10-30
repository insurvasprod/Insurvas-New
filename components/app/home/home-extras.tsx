import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight, BookOpen, BriefcaseBusiness, CalendarCheck, ContactRound, Headset, ListChecks, PhoneIncoming, PhoneOutgoing, RadioTower, Receipt, Route, SquareStack,
  TriangleAlert, Wrench, type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/stat";
import { guideHref, type SetupChecklist } from "@/lib/dashboard/checklist";
import { cn } from "@/lib/utils";

/* ── Setup ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The setup checklist, pinned until it is done (LA-0.3), as one slim row instead of a tile: how
 * far along, the next step by name, and Continue. Outline, so the header keeps the one primary.
 */
export function HomeSetup({ checklist }: { checklist: SetupChecklist }) {
  const next = checklist.steps.find((step) => !step.complete && !step.skipped) ?? null;
  return (
    <section aria-label="Get set up" data-size="panel" className="m-glass flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--primary-soft)] text-[var(--accent-ink)]" aria-hidden="true"><Wrench className="size-4" /></span>
      <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
        <p className="m-0 flex items-baseline gap-2 text-sm">
          <span className="font-semibold text-foreground">Finish setting up</span>
          <span className="tabular-nums text-muted-foreground">{checklist.completed} of {checklist.total} done</span>
        </p>
        <Meter value={checklist.completed} max={checklist.total} tone="primary" label={`${checklist.completed} of ${checklist.total} setup steps done`} className="max-w-md" />
      </div>
      {next && (
        <Link href={guideHref(next)} className="min-w-0 max-w-full truncate text-sm text-muted-foreground no-underline hover:text-foreground">
          Next: <span className="font-medium text-foreground">{next.label}</span>{next.minutes ? <span className="tabular-nums"> · {next.minutes} min</span> : null}
        </Link>
      )}
      <Button asChild variant="outline"><Link href="/app/setup">Continue setup</Link></Button>
    </section>
  );
}

/* ── Shortcuts ──────────────────────────────────────────────────────────────────────────────── */

export const MODULE_ICONS: Record<string, LucideIcon> = {
  "briefcase-business": BriefcaseBusiness,
  "calendar-check": CalendarCheck,
  "phone-incoming": PhoneIncoming,
  "radio-tower": RadioTower,
  "phone-outgoing": PhoneOutgoing,
  route: Route,
  "list-checks": ListChecks,
  "contact-round": ContactRound,
  "book-open": BookOpen,
  receipt: Receipt,
  "triangle-alert": TriangleAlert,
  headset: Headset,
};

export function moduleIcon(name: string): LucideIcon {
  return MODULE_ICONS[name] ?? SquareStack;
}

/** The modules this person can open, as one compact grid of links (the old "Everything" tab). */
export function HomeShortcuts({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="home-shortcuts" className="flex min-w-0 flex-col gap-2.5">
      <h2 id="home-shortcuts" className="m-0 text-[0.8125rem] font-medium text-muted-foreground">Jump to</h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-2 p-0">{children}</ul>
    </section>
  );
}

/** One module: its icon, name and, where this reader may see it, its live figure. */
export function ShortcutLink({ icon: Icon, label, href, figure, caption, tone }: { icon: LucideIcon; label: string; href: string; figure?: string; caption?: string; tone?: "danger" | "warning" | "good" }) {
  const ink = tone === "danger" ? "text-[var(--error-ink)]" : tone === "warning" ? "text-[var(--warning-ink)]" : "text-foreground";
  return (
    <li className="min-w-0">
      <Link
        href={href}
        title={caption ? `${label}: ${figure ?? ""} ${caption}`.trim() : label}
        className="group flex h-12 min-w-0 items-center gap-2.5 rounded-lg border border-[var(--gloss-edge)] bg-[var(--surface)] px-3 text-inherit no-underline transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-[var(--accent-ink)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
        {figure !== undefined ? (
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", ink)}>{figure}</span>
        ) : (
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        )}
      </Link>
    </li>
  );
}
