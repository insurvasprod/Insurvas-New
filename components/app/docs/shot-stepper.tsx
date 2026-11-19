"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2, PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GuideShot } from "@/lib/dashboard/guideMoves";
import type { DocShot } from "@/lib/docs/shots";
import type { DocWhere } from "@/lib/docs/where";

import { MoveShot } from "./move-shot";
import { ShotLightbox } from "./shot-lightbox";

export type ShotMove = {
  say: string;
  detail?: string;
  photo: DocShot | null;
  sketch?: GuideShot;
  label?: string | null;
  /** The menu clicks that reach this step's page (lib/docs/where.ts), for the Explain panel. */
  where?: DocWhere | null;
};

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * A task, click by click, on real screenshots. R7 (owner 2026-11-17: "keep everything within the height of the
 * page… put back right next to [the first step], as a button outside the frame of the progress bar, and the next
 * step right next to [the last one]"): one line of Back · every click as a numbered step · Next step, then the
 * chosen click's screen filling the rest of the height, with what to do written on a single line above it. No side
 * panel. ← and → step through too, and `?click=2` opens on a given click.
 */
export function ShotStepper({ moves, className, onFinish }: { moves: ShotMove[]; className?: string; /** Called once the last step is shown. */ onFinish?: () => void }) {
  const [at, setAt] = useState(0);
  // Zoomed on the lit control and its coach by default; "Whole screen" shows the rest of the page around it.
  const [whole, setWhole] = useState(false);
  // The step explained in a panel beside the picture; it stays open as you move between steps.
  const [explain, setExplain] = useState(false);
  // The picture at full size, inside the app (owner 2026-11-17: not a new tab).
  const [full, setFull] = useState(false);
  const move = moves[at];
  const focus = whole ? undefined : move?.photo?.focus;
  const last = moves.length - 1;

  useEffect(() => {
    const asked = Number(new URLSearchParams(window.location.search).get("click"));
    // A deep link from a how-to page's thumbnail: read once, after mount, so the server render stays on click 1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (asked >= 1 && asked <= moves.length) setAt(asked - 1);
  }, [moves.length]);

  // The chosen step glides to the middle of the strip (only the strip scrolls, never the page).
  const strip = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = strip.current;
    const step = list?.querySelector<HTMLElement>(`[data-step="${at}"]`);
    if (!list || !step) return;
    const box = step.getBoundingClientRect();
    const left = list.scrollLeft + (box.left - list.getBoundingClientRect().left) - (list.clientWidth - box.width) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: Math.max(left, 0), behavior: reduce ? "auto" : "smooth" });
  }, [at]);

  useEffect(() => { if (moves.length > 0 && at === last) onFinish?.(); }, [at, last, moves.length, onFinish]);

  const go = (index: number) => setAt(Math.min(Math.max(index, 0), last));
  const ratio = move?.photo ? (focus ? focus.w / focus.h : move.photo.width / move.photo.height) : 16 / 10;

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
        if (event.key === "ArrowRight") { event.preventDefault(); go(at + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(at - 1); }
      }}
    >
      <div className="flex items-stretch gap-2">
        <Button type="button" variant="outline" className="shrink-0 self-center" disabled={at === 0} onClick={() => go(at - 1)}><ChevronLeft aria-hidden="true" />Back</Button>
        <nav aria-label="Each click" className={cn(card, "min-w-0 flex-1 px-1.5 py-1.5")}>
          {/* Every label in full, on one line (owner 2026-11-17): the line scrolls sideways, and moving to a step
              glides it to the middle. */}
          <ol ref={strip} className="m-0 flex list-none items-stretch gap-1 overflow-x-auto p-0 [mask-image:linear-gradient(to_right,transparent,#000_28px,#000_calc(100%-28px),transparent)]" style={{ scrollbarWidth: "none" }}>
            {moves.map((item, index) => {
              const active = index === at;
              const past = index < at;
              return (
                <li key={index} className="flex flex-none items-center gap-1">
                  <button
                    type="button"
                    data-step={index}
                    onClick={() => setAt(index)}
                    aria-current={active ? "step" : undefined}
                    title={item.say}
                    className={cn(
                      "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[10px] border px-2 py-1 text-left transition-colors",
                      active ? "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[var(--primary-soft)]" : "border-transparent bg-transparent hover:bg-[var(--surface-hover,var(--primary-soft))]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums",
                        active ? "border-[var(--primary)] text-[var(--accent-ink)]" : past ? "border-transparent bg-[var(--success-surface,var(--primary-soft))] text-[var(--success)]" : "border-[var(--border)] text-[var(--muted)]",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className={cn("whitespace-nowrap text-sm", active ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]")}>{item.label ?? item.say}</span>
                  </button>
                  {index < last ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--border)]" /> : null}
                </li>
              );
            })}
          </ol>
        </nav>
        <Button type="button" className="shrink-0 self-center" disabled={at === last} onClick={() => go(at + 1)}>Next step<ChevronRight aria-hidden="true" /></Button>
      </div>

      {move ? (
        // The picture's frame and, when asked for, the step explained in its own card beside it (owner 2026-11-17:
        // "open a new panel outside the panel where the image sits"); the frame narrows as the card slides in.
        <div className="flex min-h-[340px] flex-1">
          <figure className={cn(card, "relative m-0 flex min-w-0 flex-1 flex-col p-2")} aria-label={`Click ${at + 1} of ${moves.length}: ${move.say}`}>
            {/* The step's words are in the strip and the Explain card; screen readers hear them here. */}
            <figcaption className="sr-only" aria-live="polite">Step {at + 1} of {moves.length}: {move.say}{move.detail ? `. ${move.detail}` : ""}</figcaption>
            {/* Top right of the frame, beside the picture (owner 2026-11-17): Explain, Whole screen, full size. */}
            <div className="absolute top-2 right-2 z-[1] flex gap-1.5">
              {move.photo?.focus ? (
                <Button type="button" variant="outline" size="sm" className="bg-[var(--color-card)]" onClick={() => setWhole(!whole)}>{whole ? "Zoom in" : "Whole screen"}</Button>
              ) : null}
              {move.photo ? (
                <button type="button" onClick={() => setFull(true)} aria-label="Full size" title="Full size" className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--color-card)] text-[var(--ink)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]"><Maximize2 aria-hidden="true" className="size-4" /></button>
              ) : null}
              <Button type="button" size="sm" variant={explain ? "outline" : "default"} aria-expanded={explain} aria-controls="shot-explain" onClick={() => setExplain(!explain)}>
                {explain ? "Hide steps" : "Explain this step"}
                {explain ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
              </Button>
            </div>
            {/* The picture is a size container: as large as the frame allows, in its own shape, under the buttons. */}
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center pt-10 [container-type:size]">
              {move.photo ? (
                <div
                  className="relative overflow-hidden rounded-[10px] border border-[var(--border)]"
                  style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, aspectRatio: `${ratio}` }}
                >
                  {/* A plain img: the screenshots are fixed-size files under public/, already compressed. Zoomed, it
                      is drawn larger and shifted so the focus box fills the frame. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={move.photo.src}
                    src={move.photo.src}
                    width={move.photo.width}
                    height={move.photo.height}
                    alt={move.photo.alt || move.say}
                    className="absolute block h-auto max-w-none transition-[width,left,top] duration-300"
                    style={focus
                      ? { width: `${(move.photo.width / focus.w) * 100}%`, left: `${(-focus.x / focus.w) * 100}%`, top: `${(-focus.y / focus.h) * 100}%` }
                      : { width: "100%", left: 0, top: 0 }}
                  />
                </div>
              ) : move.sketch ? (
                <div className="w-full max-w-[720px]"><MoveShot shot={move.sketch} label={move.label} /></div>
              ) : null}
            </div>
          </figure>

          <aside
            id="shot-explain"
            aria-label="This step explained"
            aria-hidden={!explain}
            className="min-h-0 shrink-0 overflow-hidden transition-[width,opacity,margin] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
            style={{ width: explain ? 340 : 0, opacity: explain ? 1 : 0, marginLeft: explain ? 12 : 0 }}
          >
            <div className={cn(card, "flex h-full w-[340px] flex-col gap-4 overflow-y-auto p-4")}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)] tabular-nums">Step {at + 1} of {moves.length}</span>
                <span className="flex-1" />
                <button type="button" tabIndex={explain ? 0 : -1} aria-label="Hide steps" onClick={() => setExplain(false)} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--primary-soft)] hover:text-[var(--ink)]"><X aria-hidden="true" className="size-4" /></button>
              </div>
              {move.where ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="m-0 text-xs font-semibold text-[var(--muted)]">How to get here</h3>
                  <ol className="m-0 flex list-none flex-col gap-1 p-0">
                    {move.where.trail.map((part, index) => (
                      <li key={`${part}-${index}`} className="flex items-center gap-2 text-sm text-[var(--body)]">
                        <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
                        {index === 0 ? <span>Open <span className="font-semibold text-[var(--ink)]">{part}</span> in the menu</span> : <span>Choose <span className="font-semibold text-[var(--ink)]">{part}</span></span>}
                      </li>
                    ))}
                  </ol>
                  <Link href={move.where.href} tabIndex={explain ? 0 : -1} className="self-start text-sm font-medium text-[var(--accent-ink)] no-underline hover:underline">Take me there ›</Link>
                </section>
              ) : null}
              <section className="flex flex-col gap-1">
                <h3 className="m-0 text-xs font-semibold text-[var(--muted)]">Then do this</h3>
                <p className="m-0 text-sm font-semibold text-[var(--ink)]">{move.say}</p>
              </section>
              {move.detail ? (
                <section className="flex flex-col gap-1">
                  <h3 className="m-0 text-xs font-semibold text-[var(--muted)]">Why it helps</h3>
                  <p className="m-0 text-sm text-[var(--body)]">{move.detail}</p>
                </section>
              ) : null}
              <span className="flex-1" />
              {at < last ? (
                <button type="button" tabIndex={explain ? 0 : -1} onClick={() => go(at + 1)} className="flex cursor-pointer flex-col gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-left hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]">
                  <span className="text-xs text-[var(--muted)]">Next ›</span>
                  <span className="text-sm text-[var(--ink)]">{moves[at + 1].say}</span>
                </button>
              ) : <p className="m-0 text-xs text-[var(--muted)]">That&apos;s the last step.</p>}
            </div>
          </aside>
        </div>
      ) : null}
      {full && move?.photo ? <ShotLightbox src={move.photo.src} alt={move.photo.alt || move.say} width={move.photo.width} height={move.photo.height} onClose={() => setFull(false)} /> : null}
    </div>
  );
}
