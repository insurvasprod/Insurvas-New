import { cn } from "@/lib/utils";

import { StampCheck } from "./done-stamp";

/**
 * An upload's progress (Tier 2 motion, 2026-11-17): a thin bar that fills by scale as the file goes up
 * (`data-upload-fill`, --t-data per step), and ends with the stamp's check drawing in beside "Uploaded".
 * `value` is 0–1. Server-safe: the motion is all CSS.
 */
export function UploadProgress({ name, value, className }: { name: string; value: number; className?: string }) {
  const done = value >= 1;
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-[var(--ink)]">{name}</span>
        {done
          ? <span className="m-stamp inline-flex items-center gap-1 text-xs text-[var(--success-ink)]"><StampCheck /><span data-stamp-label="">Uploaded</span></span>
          : <span className="text-xs tabular-nums text-[var(--muted)]">{percent}%</span>}
      </div>
      <div role="progressbar" aria-label={`Uploading ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
        <span data-upload-fill="" className={cn("block h-full w-full rounded-full", done ? "bg-[var(--success)]" : "bg-[var(--primary)]")} style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
    </div>
  );
}
