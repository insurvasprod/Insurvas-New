"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { CountUp } from "@/components/ui/count-up";
import { cn } from "@/lib/utils";

export type FlowStage = { label: string; value: string; count: number; note?: string; href?: string; kept?: string; trend?: { text: string; tone: "good" | "danger" | "neutral"; title: string } };
export type FlowFact = { label: string; value: string; note?: string; tone?: "default" | "good" | "warning"; href?: string };
export type FlowDrop = { text: string; lost: number; href?: string };

/**
 * The lead-to-money map (redesign 2026-10-25, owner: "the lead to money map as B"; drawn as the
 * leak stream of Dashboard D). Each hairline is a slice of what entered the first stage. A slice
 * still in at a stage runs on; one that is not peels off at that drop and falls away, so the reader
 * watches the leak happen. The worst drop (`worst`, an index into `drops`) falls in amber and pulses.
 *
 * `stages` and `drops` are plain figures the caller computed; this draws, it does not count. A count
 * can rise from one stage to the next (a lead dialled that the queue never served); the stream then
 * simply loses nothing there. Below md it is a list: the same stages and drops, no drawing.
 *
 * `mode="path"` (role maps, 2026-10-25): for a role whose work is a route rather than a funnel — the
 * assistant's inbox, callbacks and lists, the retention rep's queues — nothing peels off; the ribbon
 * runs through every stop and `hot` (a stage index) is the stop that needs them first, in amber.
 */
export function LeadFlowMap({ stages, drops, worst, label = "Where every lead went", aside, mode = "flow", hot = null, facts = [] }: { stages: FlowStage[]; drops: FlowDrop[]; worst: number | null; label?: string; aside?: ReactNode; mode?: "flow" | "path"; hot?: number | null; /** More figures in a row under the drawing. */ facts?: FlowFact[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const counts = mode === "path" ? stages.map(() => 1).join(",") : stages.map((stage) => stage.count).join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const values = counts.split(",").map(Number);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let frame = 0;
    let ink = "7, 214, 160";
    let leak = "242, 165, 65";
    const readInk = () => {
      const style = getComputedStyle(canvas);
      const a = style.getPropertyValue("--ribbon-ink").trim();
      const b = style.getPropertyValue("--leak-ink").trim();
      if (/^\d+,\s*\d+,\s*\d+$/.test(a)) ink = a;
      if (/^\d+,\s*\d+,\s*\d+$/.test(b)) leak = b;
    };

    // The share still in at each stage: never more than at the stage before.
    const top = Math.max(1, ...values);
    const alive: number[] = [];
    values.forEach((value, index) => alive.push(Math.min(index ? alive[index - 1] : 1, Math.sqrt(Math.max(0, value) / top))));
    const lines = 52;
    const strands = Array.from({ length: lines }, (_, k) => {
      const r = (k + 0.5) / lines;
      let dies = -1;
      for (let i = 1; i < alive.length; i += 1) if (r > alive[i]) { dies = i - 1; break; }
      return { r, dies };
    });

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);
      const n = values.length;
      const centre = (index: number) => ((2 * index + 1) / (2 * n)) * W;
      const bandTop = H * 0.06;
      const bandHeight = H * 0.5;
      for (const { r, dies } of strands) {
        const peelAt = dies >= 0 ? (centre(dies) + centre(dies + 1)) / 2 : W + 60;
        ctx.beginPath();
        let started = false;
        for (let x = -10; x <= W + 10; x += 6) {
          const u = x / W;
          let y = bandTop + r * bandHeight + Math.sin(u * 6 - t * 2 + r * 5) * 3 * (0.4 + r);
          if (x > peelAt) {
            const k = (x - peelAt) / 70;
            y += k * k * 26;
            if (Math.exp(-(x - peelAt) / 90) < 0.04 || y > H + 10) break;
          }
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + r * 7);
        const gradient = ctx.createLinearGradient(0, 0, W, 0);
        if (dies >= 0 && dies === worst) {
          gradient.addColorStop(0, `rgba(${ink}, ${0.16 + 0.18 * pulse})`);
          gradient.addColorStop(Math.min(1, peelAt / W), `rgba(${leak}, ${0.55 + 0.3 * pulse})`);
          gradient.addColorStop(1, `rgba(${leak}, 0.15)`);
        } else if (dies >= 0) {
          gradient.addColorStop(0, `rgba(${ink}, ${0.16 + 0.18 * pulse})`);
          gradient.addColorStop(Math.min(1, peelAt / W), `rgba(${ink}, 0.22)`);
          gradient.addColorStop(1, `rgba(${ink}, 0.04)`);
        } else {
          gradient.addColorStop(0, `rgba(${ink}, ${0.22 + 0.22 * pulse})`);
          gradient.addColorStop(1, `rgba(${ink}, ${0.5 + 0.4 * pulse})`);
        }
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const loop = () => {
      if (frame % 90 === 0) readInk();
      frame += 1;
      t += 0.006;
      draw();
      raf = window.requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && !document.hidden) raf = window.requestAnimationFrame(loop); };
    const stop = () => { window.cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => (document.hidden ? stop() : start());
    readInk();
    if (reduce) {
      draw();
      window.addEventListener("resize", draw);
      return () => window.removeEventListener("resize", draw);
    }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [counts, worst]);

  const n = stages.length;
  const target = mode === "path" ? hot ?? -1 : worst === null ? -1 : worst + 1;

  return (
    <section aria-label={label} className="m-glass relative min-w-0 overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-3.5">
        <h2 className="m-0 text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{label}</h2>
        {aside}
      </div>

      {/* md and up: the drawing, stages above it and drops below it, on one 2n-column grid. */}
      <div className="hidden px-2 pb-3 pt-3 md:block">
        <div className="grid items-center gap-y-0" style={{ gridTemplateColumns: `repeat(${2 * n}, minmax(0, 1fr))` }}>
          {stages.map((stage, index) => (
            <div key={stage.label} className="flex justify-center px-1" style={{ gridColumn: `${2 * index + 1} / span 2`, gridRow: 1 }}>
              <StageChip stage={stage} hot={index === target} />
            </div>
          ))}
          <canvas ref={canvasRef} aria-hidden="true" className="m-flow-canvas block h-[132px] w-full" style={{ gridColumn: `1 / span ${2 * n}`, gridRow: 2 }} />
          {drops.map((drop, index) => (
            <div key={`${drop.text}-${index}`} className="flex justify-center px-1" style={{ gridColumn: `${2 * index + 2} / span 2`, gridRow: 3 }}>
              <DropChip drop={drop} bad={index === worst} />
            </div>
          ))}
        </div>
      </div>

      {/* Phones: the same figures as a list. */}
      <ol className="m-0 flex list-none flex-col gap-1 p-4 pt-3 md:hidden">
        {stages.map((stage, index) => (
          <li key={stage.label} className="flex flex-col gap-1">
            <StageChip stage={stage} hot={index === target} row />
            {drops[index] && <span className="pl-3"><DropChip drop={drops[index]} bad={index === worst} /></span>}
          </li>
        ))}
      </ol>

      {facts.length > 0 && (
        <dl className="m-0 flex flex-wrap border-t border-border">
          {facts.map((fact) => <FactCell key={fact.label} fact={fact} />)}
        </dl>
      )}
    </section>
  );
}

function FactCell({ fact }: { fact: FlowFact }) {
  const body = (
    <>
      <dt className="text-xs leading-normal text-muted-foreground">{fact.label}</dt>
      <dd className={cn("m-0 truncate text-sm font-semibold leading-tight tracking-[-0.02em] tabular-nums", fact.tone === "good" ? "text-[var(--accent-ink)]" : fact.tone === "warning" ? "text-[var(--warning-ink)]" : "text-foreground")}>{fact.value}</dd>
      {fact.note && <dd className="m-0 truncate text-xs leading-normal text-muted-foreground">{fact.note}</dd>}
    </>
  );
  const className = "flex min-w-0 basis-1/2 flex-col gap-0.5 px-4 py-3 text-inherit no-underline sm:basis-1/3 lg:basis-0 lg:flex-1";
  return fact.href
    ? <Link href={fact.href} className={cn(className, "transition-colors hover:bg-[var(--surface-alt)]/40")}>{body}</Link>
    : <div className={className}>{body}</div>;
}

function StageChip({ stage, hot, row = false }: { stage: FlowStage; hot: boolean; row?: boolean }) {
  const body = (
    <>
      <span className="block text-xs leading-normal text-muted-foreground">{stage.label}</span>
      <span className="m-figure block text-lg font-semibold leading-tight tracking-[-0.02em] tabular-nums text-foreground">{/\d/.test(stage.value) ? <CountUp text={stage.value} fromZero /> : stage.value}</span>
      {stage.note && <span className="block text-xs leading-normal text-[var(--accent-ink)]">{stage.note}</span>}
      {(stage.kept || stage.trend) && (
        <span className="block text-xs leading-normal text-muted-foreground">
          {stage.kept}
          {stage.kept && stage.trend ? " · " : ""}
          {stage.trend && <span title={stage.trend.title} className={stage.trend.tone === "good" ? "text-[var(--success-ink)]" : stage.trend.tone === "danger" ? "text-[var(--error-ink)]" : undefined}>{stage.trend.text}</span>}
        </span>
      )}
    </>
  );
  const className = cn(
    "m-glass rounded-lg border px-3 py-2 text-inherit no-underline",
    row ? "flex w-full items-baseline justify-between gap-3 [&>span]:inline" : "min-w-[112px] text-center",
    hot ? "border-[color-mix(in_srgb,var(--warning)_55%,transparent)]" : "border-border",
    stage.href && "transition-colors hover:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
  );
  return stage.href ? <Link href={stage.href} className={className} aria-label={`${stage.label}: ${stage.value}`}>{body}</Link> : <div className={className}>{body}</div>;
}

function DropChip({ drop, bad }: { drop: FlowDrop; bad: boolean }) {
  const className = cn(
    "inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-normal text-inherit no-underline",
    bad ? "m-leak-pulse border-[color-mix(in_srgb,var(--warning)_55%,transparent)] bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "m-glass border-border text-muted-foreground",
  );
  return drop.href ? <Link href={drop.href} className={className}>{drop.text}</Link> : <span className={className}>{drop.text}</span>;
}
