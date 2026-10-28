import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The ground a role's home sits on (dashboard glass layer, 2026-10-13).
 *
 * The glass cards use the two still brand glows for a little depth. Background motion was removed
 * from the SaaS shell so every page has the same quiet canvas.
 */
export function DashboardStage({ children, className, ambient = true }: { children: ReactNode; className?: string; ambient?: boolean }) {
  return (
    <div className={cn("m-stage relative isolate", className)}>
      {ambient && (
        <div aria-hidden="true" className="m-ambient pointer-events-none absolute inset-x-0 -top-8 -z-10 h-[560px] overflow-hidden">
          <span className="m-ambient-orb m-ambient-orb--a" />
          <span className="m-ambient-orb m-ambient-orb--b" />
        </div>
      )}
      {children}
    </div>
  );
}
