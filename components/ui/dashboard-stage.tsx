import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { RibbonBackdrop } from "@/components/ui/ribbon-backdrop";

/**
 * The ground a role's home sits on (dashboard glass layer, 2026-10-13).
 *
 * Glass needs something behind it to blur. This draws two soft, slow-drifting brand glows at the top
 * of the page — barely there in light, a green halo in dark — and, since the 2026-10-25 redesign, the
 * landing page's moving ribbon across the whole view (RibbonBackdrop). The strips, tiles and cards
 * above pick both up through their frosted surfaces. It is one wrapper, used by the three homes (app,
 * admin, partner), so the look is set in one place rather than per page. `isolate` keeps the glow
 * layer above the page canvas without lifting it over the content.
 */
export function DashboardStage({ children, className, ribbon = false }: { children: ReactNode; className?: string; ribbon?: boolean }) {
  return (
    <div className={cn("m-stage relative isolate", ribbon && "m-stage--ribbon", className)}>
      {/* The moving ribbon, on a home that asks for it (redesign 2026-10-25). */}
      {ribbon && <RibbonBackdrop />}
      <div aria-hidden="true" className="m-ambient pointer-events-none absolute inset-x-0 -top-8 -z-10 h-[560px] overflow-hidden">
        <span className="m-ambient-orb m-ambient-orb--a" />
        <span className="m-ambient-orb m-ambient-orb--b" />
      </div>
      {children}
    </div>
  );
}
