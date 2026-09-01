import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, CalendarCheck, Circle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { DashboardTile as DashboardTileData } from "@/lib/dashboard/tiles";

const ICONS = {
  "briefcase-business": BriefcaseBusiness,
  "calendar-check": CalendarCheck,
} as const;

export function DashboardTile({ tile }: { tile: DashboardTileData }) {
  const Icon = ICONS[tile.icon as keyof typeof ICONS] ?? Circle;

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-blue)]/10 text-[var(--color-blue)]">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">{tile.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tile.description}</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between gap-4">
          <p className="text-sm text-muted-foreground">{tile.empty_state}</p>
          <Link
            href={tile.path}
            className="group inline-flex w-fit items-center gap-2 text-sm font-semibold text-[var(--color-blue)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
          >
            {tile.action_label}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
