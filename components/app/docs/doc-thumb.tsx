import { cn } from "@/lib/utils";

/** Where a screenshot zooms in: the lit control and its coach (recorded by scripts/docs-shots.mjs). */
export type DocFocus = { x: number; y: number; w: number; h: number };

/**
 * A real screenshot, small and zoomed on its click so it reads at this size (owner 2026-11-16). The 1440×900 file
 * is drawn larger and shifted so the focus box fills a 16:10 frame; with no focus it shows the whole screen.
 */
export function DocThumbImage({ src, alt, focus, className }: { src?: string; alt: string; focus?: DocFocus; className?: string }) {
  if (!src) return <span aria-hidden="true" className={cn("block aspect-[16/10] w-full rounded-[8px] border border-dashed border-[var(--border)]", className)} />;
  return (
    <span className={cn("relative block aspect-[16/10] w-full overflow-hidden rounded-[8px] border border-[var(--border)]", className)}>
      {/* A plain img: fixed-size, already-compressed files under public/docs/shots. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={1440}
        height={900}
        loading="lazy"
        className="absolute block h-auto max-w-none"
        style={focus ? { width: `${(1440 / focus.w) * 100}%`, left: `${(-focus.x / focus.w) * 100}%`, top: `${(-focus.y / focus.h) * 100}%` } : { width: "100%", left: 0, top: 0 }}
      />
    </span>
  );
}
