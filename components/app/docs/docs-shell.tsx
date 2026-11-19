import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Docs' frame, R4 (owner 2026-11-13): the Settings-style menu on the left, the page on the right, both filling
 * the window's height and the full width. Under lg the menu sits above the page. `fit` (owner 2026-11-17: "keep
 * everything within the height of the page") holds the page to the window's height too, so a task's screenshot
 * shrinks to fit instead of the page scrolling.
 */
export function DocsFrame({ menu, children, fit = false }: { menu: ReactNode; children: ReactNode; fit?: boolean }) {
  return (
    <div className={cn("grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]", fit && "lg:h-[calc(100dvh-10.5rem)] lg:flex-none")}>
      <div className="min-h-0 lg:max-h-[calc(100dvh-10.5rem)]">{menu}</div>
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  );
}
