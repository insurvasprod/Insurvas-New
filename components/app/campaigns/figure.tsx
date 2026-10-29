import type { ReactNode } from "react";

import { toneText, type FigureTone } from "@/components/app/campaigns/tones";
import { cn } from "@/lib/utils";

/**
 * One figure on Lead sources › Source (owner 2026-10-28: "small icons to be self-explanatory"): an
 * icon, a short label and the value, coloured by what it means. The meaning is the hover title and
 * is read to screen readers after the value.
 */
export function Figure({ icon, label, value, tone = null, meaning, dense = false }: { icon: ReactNode; label: string; value: ReactNode; tone?: FigureTone; meaning: string; dense?: boolean }) {
  // `dense`: the vendor scorecard (owner 2026-10-29, "tighter"): a smaller tile and tight lines, same 12/14px text.
  return <div className={cn("flex min-w-0 items-center", dense ? "gap-1.5" : "gap-2")} title={meaning}>
    <span className={cn("grid shrink-0 place-items-center rounded-md bg-[var(--surface-alt)] text-muted-foreground", dense ? "size-6 [&_svg]:size-3" : "size-7 [&_svg]:size-3.5")} aria-hidden="true">{icon}</span>
    <span className="flex min-w-0 flex-col">
      <span className={cn("truncate text-xs text-muted-foreground", dense && "leading-4")}>{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums text-[var(--ink)]", dense && "leading-5", toneText(tone))}>{value}<span className="sr-only"> · {meaning}</span></span>
    </span>
  </div>;
}
