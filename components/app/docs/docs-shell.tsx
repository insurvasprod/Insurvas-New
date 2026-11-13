import type { ReactNode } from "react";
import { PlayCircle } from "lucide-react";

import type { DocPage } from "@/lib/docs/content";

/**
 * Docs' frame, R4 (owner 2026-11-13): the Settings-style menu on the left, the page on the right, both filling
 * the window's height and the full width. Under lg the menu sits above the page.
 */
export function DocsFrame({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="min-h-0 lg:max-h-[calc(100dvh-12rem)]">{menu}</div>
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  );
}

/** The page's video slot: the video once one is attached, until then a marked place for it. */
export function DocVideo({ video, className }: { video: DocPage["video"]; className?: string }) {
  if (video.url) {
    return (
      <div className={`aspect-video w-full overflow-hidden rounded-[14px] border border-border bg-black ${className ?? ""}`}>
        <iframe src={video.url} title={video.title} className="size-full" allow="fullscreen; picture-in-picture" />
      </div>
    );
  }
  return (
    <div className={`flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border text-center text-sm text-muted-foreground ${className ?? ""}`} data-video-slot={video.key}>
      <PlayCircle aria-hidden="true" className="size-10" strokeWidth={1.3} />
      <span className="font-medium text-foreground">Video coming · {video.title}</span>
      <span className="text-xs">A short screen recording will play here.</span>
    </div>
  );
}
