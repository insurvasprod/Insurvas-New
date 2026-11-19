"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SHOW_MODES, SHOW_PARAM, showOf, type ShowMode } from "@/lib/reports/show";

import { cn } from "@/lib/utils";

import { useGlidePill } from "./tab-track";
import { SWITCH_FRAME, switchOption } from "./view-tabs";

const LABEL: Record<ShowMode, string> = { table: "Table", chart: "Chart" };

/**
 * The "Table · Chart" switch (Reports round 7, owner pick 0·A, 2026-11-11): two options in the boxed switch's
 * look (IconViewSwitch's, components/ui/view-tabs.tsx), on the title line beside the page's buttons. It keeps
 * the view in the address (`?show=table|chart`, lib/reports/show.ts) and every other parameter with it, so a
 * reload, a bookmark or a chart's bar (`showHref(…, "table", { carrier })`) lands on the same view.
 *
 * `fallback` is the view with no `?show=`: "chart" on a report, "table" on a drill. Choosing replaces the
 * address in place (no history entry, no scroll), and the switch shows the choice at once while the page
 * follows. A server page reads the same value with `showOf(searchParams, fallback)`; a client view with
 * `useShow(fallback)`.
 */
export function ViewSwitch({ fallback = "chart", label = "Show as", className }: {
  fallback?: ShowMode;
  label?: string;
  className?: string;
}) {
  // The chosen look is one soft pill that slides between Table and Chart (TabTrack's measuring, `useGlidePill`; Tier 1
  // motion, every switch since Wave A 2026-11-17). The view under it crosses in with ShowSwap, in the frame.
  const track = useRef<HTMLDivElement>(null);
  const pill = useGlidePill(track, { items: ':scope > [role="radio"]', chosen: '[aria-checked="true"]', watch: "aria-checked" });
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const current = showOf(query, fallback);
  const [chosen, setChosen] = useState<ShowMode | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = pending && chosen ? chosen : current;

  const choose = (mode: ShowMode) => {
    if (mode === current) return;
    const params = new URLSearchParams(query.toString());
    params.set(SHOW_PARAM, mode);
    setChosen(mode);
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      data-glide-track=""
      className={`${SWITCH_FRAME} relative isolate${className ? ` ${className}` : ""}`}
      // A radio group moves with the arrow keys; Tab reaches only the chosen option.
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const next = SHOW_MODES.find((mode) => mode !== shown) ?? shown;
        choose(next);
        (event.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLButtonElement | null)?.focus();
      }}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-tab-pill={pill.glide ? "glide" : ""}
          data-tab-indicator="soft"
          style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }}
        />
      )}
      {SHOW_MODES.map((mode) => {
        const selected = shown === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-mode={mode}
            onClick={() => choose(mode)}
            className={cn(switchOption(selected, "inline-flex h-8 items-center px-3 text-sm font-semibold"), pill && "bg-transparent")}
          >
            {LABEL[mode]}
          </button>
        );
      })}
    </div>
  );
}

/** The view a client screen draws: `?show=` when it is set, `fallback` otherwise (it follows the switch). */
export function useShow(fallback: ShowMode = "chart"): ShowMode {
  return showOf(useSearchParams(), fallback);
}

/**
 * The view under the switch (Tier 1 motion, Wave A 2026-11-17): keyed on the current `?show=`, so flipping Table ·
 * Chart remounts it and it crosses in with `m-swap`. Only a flip moves it: the view the page opened on arrives with the
 * calm cascade, so it carries no animation of its own. Used once per frame (ReportsPage, RetentionPage), never per page.
 */
export function ShowSwap({ fallback, children }: { fallback: ShowMode; children: ReactNode }) {
  const show = useShow(fallback);
  const [opened] = useState(show);
  const [flipped, setFlipped] = useState(false);
  if (show !== opened && !flipped) setFlipped(true);
  // The frame's column look (FRAME_STEP's flex column and 16px gap), so the view's blocks sit as they did unwrapped.
  return <div key={show} data-show-swap="" className={cn("flex min-w-0 flex-col gap-4 [&>*]:shrink-0", flipped && "m-swap")}>{children}</div>;
}
