import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The ground a role's home sits on (dashboard glass layer, 2026-10-13).
 *
 * A quiet canvas: no motion and, since the design-system pass of 2026-11-02, no brand glows behind
 * the cards either. Every page has the same plain ground.
 *
 * Foundation v3 (2026-10-27): the three shell layouts draw it once around every page, so a page
 * never adds its own.
 */
export function DashboardStage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("m-stage relative isolate", className)}>{children}</div>;
}
