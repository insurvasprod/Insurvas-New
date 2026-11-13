"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DocVideo } from "@/components/app/docs/docs-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { MenuCard, type MenuCardItem } from "@/components/ui/menu-card";
import { FactsStrip, NumberedSteps } from "@/components/ui/numbered-steps";
import { StatusChip } from "@/components/ui/status-chip";
import { guideHref, type SetupChecklistStep } from "@/lib/dashboard/checklist";
import { guideMovesFor } from "@/lib/dashboard/guideMoves";

import { readPausedGuide, withMove, type PausedGuide } from "./setup-guide-bar";
import { markSetupStep } from "./setup-step-list";

export type SetupPathStep = Pick<SetupChecklistStep, "key" | "label" | "path" | "why" | "instruction" | "target" | "minutes" | "complete" | "skipped" | "optional">;

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";


/**
 * Get set up, R4 G1·A (owner 2026-11-13). Left: every step in the Settings-style menu card, grouped by phase,
 * each with its ring and minutes (or "done"). Right: the chosen step, explained before you start it, or once Ready
 * to sell is done, a summary worth showing a client (G2). Phase 1 is required and guided; 2 and 3 are optional.
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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this browser's copy, for a pause made before the server kept it
    setLocalPause(readPausedGuide());
  }, []);
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
  let number = 0;
  const groups = [
    ...(required.length > 0 ? [{ key: "required", label: readyLabel, number: ++number, progress: { done: required.filter((step) => step.complete).length, total: required.length }, aside: <StatusChip tone="warning">Required</StatusChip>, items: required.map(item) }] : []),
    ...(optional.length > 0 ? [{ key: "optional", label: "Run it your way", number: ++number, progress: { done: optionalDone, total: optional.length }, aside: <StatusChip tone="neutral">Optional</StatusChip>, items: optional.map(item) }] : []),
    { key: "learn", label: "Learn", number: ++number, items: [{ key: "docs", label: "Docs", href: "/app/docs", trailing: `${docPages} pages` }] },
  ];

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <MenuCard label="Setup steps" groups={groups} openAll footer="Everything you skip runs on Insurvas defaults." className="lg:max-h-[calc(100dvh-12rem)]" />
      {showSummary ? (
        <Summary required={required} optional={optional} readyLabel={readyLabel} docPages={docPages} teamSetup={teamSetup} counts={counts} />
      ) : chosen ? (
        <StepDetail
          step={chosen}
          index={(chosen.optional ? optional : required).findIndex((step) => step.key === chosen.key)}
          of={(chosen.optional ? optional : required).length}
          paused={chosen.key === pausedStep?.key ? pausedMove : null}
          video={docs[chosen.key]}
          following={(chosen.optional ? optional : required).find((step) => step.key !== chosen.key && !step.complete && !step.skipped) ?? null}
          readyLabel={readyLabel}
          onReviewed={() => void markSetupStep("skip", chosen.key).then((ok) => { if (ok) router.refresh(); })}
        />
      ) : null}
    </div>
  );
}

function StepDetail({ step, index, of, paused, video, following, readyLabel, onReviewed }: {
  step: SetupPathStep;
  index: number;
  of: number;
  paused: number | null;
  video?: { key: string; title: string; url?: string };
  following: SetupPathStep | null;
  readyLabel: string;
  onReviewed: () => void;
}) {
  const moves = guideMovesFor(step);
  const href = guideHref(step);
  const reviewed = step.optional && step.skipped && !step.complete;
  return (
    <div className="grid min-h-0 min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className={`${card} flex flex-col gap-2.5 p-5`}>
          <div className="flex flex-wrap items-center gap-2.5">
            {step.complete ? <StatusChip tone="good">Done</StatusChip> : paused !== null ? <StatusChip tone="warning">Paused at move {Math.min(paused + 1, moves.length)} of {moves.length}</StatusChip> : step.optional ? <StatusChip tone="neutral">{reviewed ? "Reviewed" : "Optional"}</StatusChip> : <StatusChip tone="warning">Required</StatusChip>}
            <span className="text-xs tabular-nums text-[var(--muted)]">{step.optional ? "Optional setting" : `Step ${index + 1} of ${of}`}{step.minutes ? ` · about ${step.minutes} min` : ""}</span>
          </div>
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">{step.label}</h2>
          <p className="m-0 text-sm text-[var(--muted)]">{step.why}</p>
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            {step.complete ? (
              <>
                <Link href={step.path} className={buttonVariants({ variant: "outline" })}>Open it</Link>
                <Link href={href} className={buttonVariants({ variant: "ghost" })}>Guide me again</Link>
              </>
            ) : (
              <>
                <Link href={paused !== null ? withMove(href, paused) : href} className={buttonVariants({ variant: "highlight" })}>{paused !== null ? "Resume ›" : "Start · Insurvas shows every click"}</Link>
                {video ? <Link href={`/app/docs/${step.key}`} className={buttonVariants({ variant: "outline" })}>Watch how</Link> : null}
                {step.optional && !reviewed ? <Button type="button" variant="ghost" onClick={onReviewed}>Mark reviewed</Button> : null}
              </>
            )}
          </div>
        </section>
        {video ? <DocVideo video={video} /> : null}
      </div>
      <section className={`${card} flex min-w-0 flex-col gap-2 px-5 pt-4 pb-4`}>
        <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">What you&apos;ll click</h3>
        <NumberedSteps steps={moves.map((move, at) => ({ key: String(at), title: move.say, detail: move.detail, state: step.complete ? "done" : paused !== null && at < paused ? "done" : paused !== null && at === paused ? "current" : "todo" }))} />
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--muted)]">{following ? `Next after this: ${following.label}` : step.optional ? "The last optional setting" : `This finishes ${readyLabel}`}</span>
          <span className="flex-1" />
          {video ? <Link href={`/app/docs/${step.key}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Read it in Docs ›</Link> : null}
        </div>
      </section>
    </div>
  );
}

function Summary({ required, optional, readyLabel, docPages, teamSetup, counts }: { required: SetupPathStep[]; optional: SetupPathStep[]; readyLabel: string; docPages: number; teamSetup: boolean; counts: { carriers: number | null; states: number | null; leads: number | null; team: number | null } | null }) {
  const minutes = required.reduce((sum, step) => sum + (step.minutes ?? 0), 0);
  const reviewed = optional.filter((step) => step.complete || step.skipped).length;
  const nextOptional = optional.find((step) => !step.complete && !step.skipped) ?? null;
  return (
    <section className={`${card} flex min-h-0 min-w-0 flex-col gap-4 p-6 lg:max-h-[calc(100dvh-12rem)]`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusChip tone="good">{readyLabel}</StatusChip>
        <span className="text-xs text-[var(--muted)]">{required.length > 0 ? "Every required step is done" : "Nothing is required on your plan"}</span>
      </div>
      <h2 className="m-0 text-base font-semibold text-[var(--ink)]">{readyLabel === "Ready to sell" ? "Your agency is ready to sell" : "You're ready to work"}</h2>
      {counts ? (
        <FactsStrip facts={[
          ...(counts.carriers !== null ? [{ label: "Carriers", value: counts.carriers.toLocaleString("en-US") }] : []),
          ...(counts.states !== null ? [{ label: "States", value: counts.states.toLocaleString("en-US") }] : []),
          ...(counts.leads !== null ? [{ label: "Leads in", value: counts.leads.toLocaleString("en-US") }] : []),
          ...(counts.team !== null ? [{ label: "Team", value: counts.team.toLocaleString("en-US") }] : []),
        ]} />
      ) : null}
      <FactsStrip facts={[
        { label: "Required steps", value: `${required.filter((step) => step.complete).length} of ${required.length}` },
        { label: "Time it takes", value: `About ${minutes} min` },
        { label: "Optional settings", value: `${reviewed} of ${optional.length} reviewed` },
        { label: "Docs", value: `${docPages} pages` },
      ]} />
      <NumberedSteps steps={required.map((step) => ({ key: step.key, title: step.label, state: "done" }))} className="min-h-0 flex-1 overflow-y-auto" />
      <span className="flex-1" />
      <div className="flex flex-wrap gap-2.5 border-t border-[var(--border)] pt-4">
        {nextOptional ? <Link href={`/app/setup?step=${encodeURIComponent(nextOptional.key)}`} className={buttonVariants({ variant: "highlight" })}>Next: {nextOptional.label} · optional</Link> : null}
        <Link href="/app/docs" className={buttonVariants({ variant: "outline" })}>Open Docs</Link>
        {teamSetup ? <Link href="/app/agency/team-setup" className={buttonVariants({ variant: "ghost" })}>Team setup ›</Link> : null}
      </div>
    </section>
  );
}
