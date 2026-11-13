import type { ReactNode } from "react";

import type { GuideShot } from "@/lib/dashboard/guideMoves";
import { cn } from "@/lib/utils";

const bar = "rounded-[4px] bg-[var(--surface-alt)]";
const lit = "rounded-[6px] bg-[var(--primary)] text-xs font-semibold leading-none text-primary-foreground shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_30%,transparent)]";

function Lit({ label, className }: { label?: string | null; className?: string }) {
  return <span className={cn(lit, "flex items-center justify-center truncate px-2", className)}>{label ?? ""}</span>;
}

function Rows({ count = 3, litAt, check }: { count?: number; litAt?: number; check?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, at) => (
        <span key={at} className={cn("flex items-center gap-2 rounded-[6px] px-1.5 py-1", at === litAt && !check && "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] ring-2 ring-[var(--primary)]")}>
          {check ? <span className={cn("size-3 shrink-0 rounded-[3px] border", at === litAt ? "border-transparent bg-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_30%,transparent)]" : "border-[var(--border-strong)]")} /> : null}
          <span className={cn(bar, "h-2 flex-1")} style={{ maxWidth: `${70 - at * 12}%` }} />
          <span className={cn(bar, "h-2 w-10")} />
        </span>
      ))}
    </>
  );
}

/**
 * A small picture of the screen for one guide move (R4 D3): the page's shape drawn in a few bars, with the one
 * control to touch lit in the accent and labelled with its own name. A sketch, not a screenshot, so it never goes
 * stale when a page changes colour or copy.
 */
export function MoveShot({ shot, label }: { shot: GuideShot; label?: string | null }) {
  let body: ReactNode;
  switch (shot) {
    case "list":
      body = <div className="flex flex-col gap-1"><span className={cn(bar, "mb-1 h-2.5 w-1/2")} /><Rows count={3} litAt={0} check /></div>;
      break;
    case "footer-button":
      body = <div className="flex h-full flex-col gap-1.5"><span className={cn(bar, "h-2.5 w-2/3")} /><Rows count={2} /><span className="flex-1" /><div className="flex justify-end"><Lit label={label} className="h-6 max-w-[60%]" /></div></div>;
      break;
    case "toolbar-button":
      body = <div className="flex flex-col gap-1.5"><div className="flex items-center gap-2"><span className={cn(bar, "h-3 w-1/3")} /><span className="flex-1" /><Lit label={label} className="h-6 max-w-[55%]" /></div><Rows count={3} /></div>;
      break;
    case "dialog":
      body = (
        <div className="relative h-full">
          <div className="absolute inset-0 flex flex-col gap-1 opacity-40"><Rows count={4} /></div>
          <div className="absolute inset-x-[12%] inset-y-1 flex flex-col gap-1.5 rounded-[8px] border border-[var(--border-strong)] bg-[var(--color-card)] p-2 shadow-lg">
            <span className={cn(bar, "h-2.5 w-1/2")} />
            <span className="h-4 rounded-[4px] border border-[var(--border-strong)]" />
            <span className="h-4 rounded-[4px] border border-[var(--border-strong)]" />
            <span className="flex-1" />
            <div className="flex justify-end"><Lit label={label} className="h-5 max-w-[70%]" /></div>
          </div>
        </div>
      );
      break;
    case "grid":
      body = <div className="grid grid-cols-5 gap-1">{Array.from({ length: 10 }, (_, at) => <span key={at} className={cn("h-5 rounded-[4px] border", at === 2 ? "border-transparent bg-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_30%,transparent)]" : "border-[var(--border-strong)]")} />)}</div>;
      break;
    case "table":
      body = <div className="flex flex-col gap-1 rounded-[6px] ring-2 ring-[var(--primary)] p-1"><span className={cn(bar, "h-2 w-1/3")} /><Rows count={3} /></div>;
      break;
    case "row":
      body = <div className="flex flex-col gap-1"><span className={cn(bar, "mb-1 h-2.5 w-1/3")} /><Rows count={4} litAt={1} /></div>;
      break;
    case "upload":
      body = <div className="flex h-full items-center justify-center rounded-[8px] border-2 border-dashed border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"><Lit label={label ?? "Choose a file"} className="h-6" /></div>;
      break;
    case "field":
      body = <div className="flex flex-col gap-1.5"><span className={cn(bar, "h-2 w-1/4")} /><span className="h-6 rounded-[5px] border-2 border-[var(--primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--primary)_25%,transparent)]" /><span className={cn(bar, "mt-1 h-2 w-1/4")} /><span className="h-6 rounded-[5px] border border-[var(--border-strong)]" /></div>;
      break;
    case "map":
      body = (
        <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[6px] p-1 ring-2 ring-[var(--primary)]">
          <div className="flex flex-col gap-1">{[0, 1, 2].map((at) => <span key={at} className={cn(bar, "h-3")} />)}</div>
          <svg width="28" height="44" viewBox="0 0 28 44" aria-hidden="true" className="text-[var(--accent-ink)]"><path d="M0 6 C14 6 14 22 28 22 M0 22 C14 22 14 6 28 6 M0 38 C14 38 14 38 28 38" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          <div className="flex flex-col gap-1">{[0, 1, 2].map((at) => <span key={at} className={cn(bar, "h-3")} />)}</div>
        </div>
      );
      break;
    case "menu":
      body = (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2"><span className={cn(bar, "h-3 w-1/3")} /><span className="flex-1" /><span className="h-5 w-12 rounded-[5px] border border-[var(--border-strong)]" /></div>
          <div className="ml-auto flex w-[55%] flex-col gap-1 rounded-[6px] border border-[var(--border-strong)] bg-[var(--color-card)] p-1"><span className={cn(bar, "h-2")} /><Lit label="Change a manager" className="h-5" /><span className={cn(bar, "h-2")} /></div>
        </div>
      );
      break;
    default:
      body = <div className="flex h-full flex-col gap-1.5 rounded-[6px] p-1.5 ring-2 ring-[var(--primary)]"><span className={cn(bar, "h-2.5 w-1/2")} /><Rows count={2} /></div>;
  }
  return (
    <div aria-hidden="true" className="mt-2 h-[104px] w-full max-w-[340px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2.5">
      {body}
    </div>
  );
}
