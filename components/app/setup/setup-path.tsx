"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { ShotStepper } from "@/components/app/docs/shot-stepper";
import { Button, buttonVariants } from "@/components/ui/button";
import { MenuCard, type MenuCardItem } from "@/components/ui/menu-card";
import { DOC_SHOTS } from "@/lib/docs/shots";
import { StatusChip } from "@/components/ui/status-chip";
import { Meter } from "@/components/ui/stat";
import { guideHref, type SetupChecklistStep } from "@/lib/dashboard/checklist";
import { guideMovesFor, shotLabel } from "@/lib/dashboard/guideMoves";
import { cn } from "@/lib/utils";
import type { DocWhere } from "@/lib/docs/where";

import { readPausedGuide, withMove, withRun, type PausedGuide } from "./setup-guide-bar";
import { markSetupStep } from "./setup-step-list";

import { titleCaseNode } from "@/components/ui/title-case";
export type SetupPathStep = Pick<SetupChecklistStep, "key" | "label" | "path" | "why" | "instruction" | "target" | "minutes" | "complete" | "skipped" | "optional"> & {
  /** The menu clicks that reach its page, worked out on the server (lib/docs/where.ts), for the Explain panel. */
  where?: DocWhere | null;
};

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";
const COLLAPSED_KEY = "insurvas.setup.menuCollapsed";
// The page below the title line, to the window's foot (owner 2026-11-17: "use more height to the bottom").
// flex-none: the shell's column grows with its content, so a growing flex item would ignore this height.
const FULL_HEIGHT = "lg:h-[calc(100dvh-10.5rem)] lg:flex-none";

/**
 * Get set up, R7 (owner 2026-11-17). Left: every step in the Settings-style menu card, grouped by phase, which
 * folds away to a slim rail so the step gets the whole width. Right: the chosen step on one line (what it is, why,
 * Start or Open it, Read it in Docs), then its clicks on real screens filling the rest of the window. Once Ready to
 * sell is done, the right side shows what the agency set up, each step a card that opens it, and what's next.
 */
export function SetupPath({ required, optional, nextKey, askedKey, readyLabel, serverPaused, docs, docPages, teamSetup, counts }: {
  required: SetupPathStep[];
  optional: SetupPathStep[];
  nextKey: string | null;
  askedKey: string | null;
  readyLabel: string;
  serverPaused: { key: string; move: number } | null;
  docs: Record<string, { key: string; title: string; url?: string }>;
  docPages: number;
  teamSetup: boolean;
  /** What the agency has set up, for the finished summary (owner only). */
  counts: { carriers: number | null; states: number | null; leads: number | null; team: number | null } | null;
}) {
  const router = useRouter();
  const [localPause, setLocalPause] = useState<PausedGuide | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this browser's copy, for a pause made before the server kept it
    setLocalPause(readPausedGuide());
    try { if (window.localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true); } catch { /* private window: open */ }
  }, []);
  const fold = (next: boolean) => {
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* not kept */ }
  };
  const pausedKey = serverPaused?.key ?? localPause?.key ?? null;
  const pausedMove = serverPaused?.move ?? localPause?.move ?? 0;

  const all = [...required, ...optional];
  const leftRequired = required.filter((step) => !step.complete);
  const pausedStep = pausedKey ? required.find((step) => step.key === pausedKey && !step.complete) ?? null : null;
  const chosen = (askedKey ? all.find((step) => step.key === askedKey) : undefined) ?? pausedStep ?? (nextKey ? all.find((step) => step.key === nextKey) : undefined) ?? null;
  const showSummary = !chosen && leftRequired.length === 0;

  const item = (step: SetupPathStep): MenuCardItem => ({
    key: step.key,
    label: step.label,
    href: `/app/setup?step=${encodeURIComponent(step.key)}`,
    active: chosen?.key === step.key,
    state: step.complete || (step.optional && step.skipped) ? "done" : step.key === pausedStep?.key ? "paused" : step.key === nextKey ? "current" : "todo",
    trailing: step.complete ? null : step.optional && step.skipped ? "reviewed" : step.key === pausedStep?.key ? "paused" : step.minutes ? `${step.minutes} min` : null,
  });
  const optionalDone = optional.filter((step) => step.complete || step.skipped).length;
  const requiredDone = required.filter((step) => step.complete).length;
  let number = 0;
  const groups = [
    ...(required.length > 0 ? [{ key: "required", label: readyLabel, number: ++number, progress: { done: requiredDone, total: required.length }, aside: <StatusChip tone="warning">Required</StatusChip>, items: required.map(item) }] : []),
    ...(optional.length > 0 ? [{ key: "optional", label: "Run it your way", number: ++number, progress: { done: optionalDone, total: optional.length }, aside: <StatusChip tone="neutral">Optional</StatusChip>, items: optional.map(item) }] : []),
    { key: "learn", label: "Learn", number: ++number, items: [{ key: "docs", label: "Docs", href: "/app/docs", trailing: `${docPages} pages` }] },
  ];

  return (
    <div className={cn("grid min-h-0 flex-1 gap-4 lg:grid-rows-[minmax(0,1fr)]", FULL_HEIGHT, collapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[320px_minmax(0,1fr)]")}>
      {collapsed ? (
        <aside aria-label="Setup steps" className={cn(card, "flex flex-row items-center gap-3 p-2 lg:flex-col")}>
          <Button type="button" variant="ghost" size="sm" className="size-9 p-0" aria-label="Show the steps" title="Show the steps" onClick={() => fold(false)}><PanelLeftOpen aria-hidden="true" className="size-4" /></Button>
          <span className="text-xs font-semibold tabular-nums text-[var(--muted)] lg:[writing-mode:vertical-rl]">{readyLabel} · {requiredDone} of {required.length}</span>
        </aside>
      ) : (
        <MenuCard
          label="Setup steps"
          groups={groups}
          openAll
          header={
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">Steps</span>
              <Button type="button" variant="ghost" size="sm" className="size-8 p-0" aria-label="Hide the steps" title="Hide the steps" onClick={() => fold(true)}><PanelLeftClose aria-hidden="true" className="size-4" /></Button>
            </div>
          }
          footer="Everything you skip runs on Insurvas defaults."
          className="min-h-0"
        />
      )}
      {showSummary ? (
        <Summary required={required} optional={optional} readyLabel={readyLabel} teamSetup={teamSetup} counts={counts} />
      ) : chosen ? (
        <StepDetail
          step={chosen}
          index={(chosen.optional ? optional : required).findIndex((step) => step.key === chosen.key)}
          of={(chosen.optional ? optional : required).length}
          paused={chosen.key === pausedStep?.key ? pausedMove : null}
          doc={docs[chosen.key]}
          following={(chosen.optional ? optional : required).find((step) => step.key !== chosen.key && !step.complete && !step.skipped) ?? null}
          readyLabel={readyLabel}
          onReviewed={() => void markSetupStep("skip", chosen.key).then((ok) => { if (ok) router.refresh(); })}
        />
      ) : null}
    </div>
  );
}

function StepDetail({ step, index, of, paused, doc, following, readyLabel, onReviewed }: {
  step: SetupPathStep;
  index: number;
  of: number;
  paused: number | null;
  /** The step's Docs page, when it has one. */
  doc?: { key: string; title: string };
  following: SetupPathStep | null;
  readyLabel: string;
  onReviewed: () => void;
}) {
  const moves = guideMovesFor(step);
  const href = guideHref(step);
  const reviewed = step.optional && step.skipped && !step.complete;
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      {/* The step on one line: what it is and why on the left, what to do on the right (owner 2026-11-17: the side
          panel is gone, "Read it in Docs" and what comes next live here). */}
      <section className={`${card} flex flex-wrap items-center gap-x-5 gap-y-2.5 px-5 py-3.5`}>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 text-base font-semibold text-[var(--ink)]">{step.label}</h2>
            {step.complete ? <StatusChip tone="good">Done</StatusChip> : paused !== null ? <StatusChip tone="warning">Paused at move {Math.min(paused + 1, moves.length)} of {moves.length}</StatusChip> : step.optional ? <StatusChip tone="neutral">{reviewed ? "Reviewed" : "Optional"}</StatusChip> : <StatusChip tone="warning">Required</StatusChip>}
            <span className="text-xs tabular-nums text-[var(--muted)]">{step.optional ? "Optional setting" : `Step ${index + 1} of ${of}`}{step.minutes ? ` · about ${step.minutes} min` : ""}</span>
          </div>
          <p className="m-0 text-sm text-[var(--muted)]">
            {step.why}
            <span className="text-[var(--muted)]"> · {following ? `Next: ${following.label}` : step.optional ? "The last optional setting" : `This finishes ${readyLabel}`}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {step.complete ? (
            <>
              <Link href={step.path} className={buttonVariants({ variant: "outline" })}>Open It</Link>
              <Link href={href} className={buttonVariants({ variant: "ghost" })}>Guide Me Again</Link>
            </>
          ) : (
            <>
              {/* Ready to sell runs as one walk: Start opens this step, and each finished step opens the next (owner 2026-11-16). */}
              <Link href={step.optional ? (paused !== null ? withMove(href, paused) : href) : withRun(paused !== null ? withMove(href, paused) : href)} className={buttonVariants({ variant: "highlight" })}>{titleCaseNode(<>{paused !== null ? "Resume ›" : "Start · Insurvas shows every click"}</>)}</Link>
              {step.optional && !reviewed ? <Button type="button" variant="ghost" onClick={onReviewed}>Mark reviewed</Button> : null}
            </>
          )}
          {doc ? <Link href={`/app/docs/${step.key}`} className={buttonVariants({ variant: "ghost" })}>Read It in Docs ›</Link> : null}
        </div>
      </section>
      {/* Every click on the real screens, as tall as the window allows (owner 2026-11-17). */}
      <ShotStepper moves={moves.map((move, at) => ({ say: move.say, detail: move.detail, photo: DOC_SHOTS[step.key]?.[at] ?? null, sketch: move.shot, label: shotLabel(move.say), where: step.where ?? null }))} />
    </div>
  );
}

/**
 * Ready to sell, done (owner 2026-11-17: the old summary "doesn't have a meaning"). What the agency now has, in
 * figures; every step it set up as a card that opens it or replays its guide; and beside them, what's next.
 */
function Summary({ required, optional, readyLabel, teamSetup, counts }: { required: SetupPathStep[]; optional: SetupPathStep[]; readyLabel: string; teamSetup: boolean; counts: { carriers: number | null; states: number | null; leads: number | null; team: number | null } | null }) {
  const minutes = required.reduce((sum, step) => sum + (step.minutes ?? 0), 0);
  const left = optional.filter((step) => !step.complete && !step.skipped);
  const reviewed = optional.length - left.length;
  // Each figure opens the page of the step that set it.
  const pathOf = (key: string, fallback: string) => required.find((step) => step.key === key)?.path ?? fallback;
  const figures = counts ? [
    ...(counts.carriers !== null ? [{ label: "Carriers", value: counts.carriers, href: pathOf("carriers", "/app/settings") }] : []),
    ...(counts.states !== null ? [{ label: "States", value: counts.states, href: pathOf("states", "/app/settings") }] : []),
    ...(counts.leads !== null ? [{ label: "Leads in", value: counts.leads, href: pathOf("import", "/app/leads") }] : []),
    ...(counts.team !== null ? [{ label: "Team", value: counts.team, href: pathOf("team", "/app/settings") }] : []),
  ] : [];
  return (
    <div className="grid min-h-0 min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[minmax(0,1fr)]">
      <section className={`${card} flex min-h-0 min-w-0 flex-col gap-4 p-5`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <CheckCircle2 aria-hidden="true" className="size-6 text-[var(--success)]" />
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">{readyLabel === "Ready to sell" ? "Your agency is ready to sell" : "You're ready to work"}</h2>
          <span className="text-xs text-[var(--muted)]">{required.length > 0 ? `All ${required.length} required steps done · about ${minutes} min of setup` : "Nothing is required on your plan"}</span>
        </div>
        {figures.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {figures.map((figure) => (
              <Link key={figure.label} href={figure.href} className="flex flex-col gap-0.5 rounded-[12px] border border-[var(--border)] px-3.5 py-2.5 no-underline hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]">
                <span className="text-xs text-[var(--muted)]">{figure.label}</span>
                <span className="text-xl font-semibold tabular-nums text-[var(--ink)]">{figure.value.toLocaleString("en-US")}</span>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <h3 className="m-0 text-xs font-semibold text-[var(--muted)]">What you set up</h3>
          <ol className="m-0 grid min-h-0 flex-1 list-none auto-rows-fr grid-cols-1 gap-2 overflow-y-auto p-0 md:grid-cols-2 2xl:grid-cols-3">
            {required.map((step, at) => (
              <li key={step.key} className="flex min-h-[92px] min-w-0 flex-col gap-1 rounded-[12px] border border-[var(--border)] px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success-surface,var(--primary-soft))] text-xs font-semibold tabular-nums text-[var(--success)]">{at + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{step.label}</span>
                </div>
                <p className="m-0 line-clamp-2 text-xs text-[var(--muted)]">{step.why}</p>
                <span className="flex-1" />
                <div className="flex items-center gap-3 text-xs">
                  <Link href={step.path} className="font-medium text-[var(--accent-ink)] no-underline hover:underline">Open it ›</Link>
                  <Link href={`/app/setup?step=${encodeURIComponent(step.key)}`} className="text-[var(--muted)] no-underline hover:underline">See its clicks</Link>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <aside aria-label="What's next" className={`${card} flex min-h-0 min-w-0 flex-col gap-3 p-5`}>
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">Run it your way</h2>
          <span className="text-xs text-[var(--muted)]">Optional settings · {reviewed} of {optional.length} reviewed. Anything you leave runs on Insurvas defaults.</span>
          <Meter value={reviewed} max={Math.max(optional.length, 1)} tone="primary" label={`${reviewed} of ${optional.length} reviewed`} />
        </div>
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto p-0">
          {optional.map((step) => {
            const done = step.complete || step.skipped;
            return (
              <li key={step.key}>
                <Link href={`/app/setup?step=${encodeURIComponent(step.key)}`} className="flex min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm no-underline hover:bg-[var(--surface-alt)]">
                  {done ? <CheckCircle2 aria-label="Reviewed" className="size-4 shrink-0 text-[var(--success)]" /> : <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-[var(--border)]" />}
                  <span className={cn("min-w-0 flex-1 truncate", done ? "text-[var(--muted)]" : "text-[var(--ink)]")}>{step.label}</span>
                  {!done && step.minutes ? <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{step.minutes} min</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
          {left[0] ? <Link href={`/app/setup?step=${encodeURIComponent(left[0].key)}`} className={buttonVariants({ variant: "highlight" })}>{titleCaseNode(<>Next: {left[0].label}</>)}</Link> : null}
          <Link href="/app/docs" className={buttonVariants({ variant: "outline" })}>Open Docs</Link>
          {teamSetup ? <Link href="/app/agency/team-setup" className={buttonVariants({ variant: "ghost" })}>Team Setup ›</Link> : null}
        </div>
      </aside>
    </div>
  );
}
