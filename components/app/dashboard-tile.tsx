import Link from "next/link";
import {
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck,
  ChevronRight,
  Circle,
  ContactRound,
  ListChecks,
  PhoneIncoming,
  PhoneOutgoing,
  RadioTower,
  Receipt,
  Route,
} from "lucide-react";

import type { DashboardTile as DashboardTileData } from "@/lib/dashboard/tiles";

// Keyed by the same icon names the menu uses, so a tile and its sidebar entry cannot disagree.
const ICONS = {
  "book-open": BookOpen,
  "briefcase-business": BriefcaseBusiness,
  "calendar-check": CalendarCheck,
  "contact-round": ContactRound,
  "list-checks": ListChecks,
  "phone-incoming": PhoneIncoming,
  "phone-outgoing": PhoneOutgoing,
  "radio-tower": RadioTower,
  receipt: Receipt,
  route: Route,
} as const;

/**
 * The whole tile is the link.
 *
 * It used to be a card with a text link inside it, which gave the pointer a 40x16px target on a
 * 300px object and meant two things to aim at. One target, one destination, and the chevron says
 * where it goes.
 */
export function DashboardTile({ tile }: { tile: DashboardTileData }) {
  const Icon = ICONS[tile.icon as keyof typeof ICONS] ?? Circle;

  return (
    <Link
      href={tile.path}
      aria-label={`${tile.label} — ${tile.action_label}`}
      className="portal-dashboard-tile group flex h-full items-start gap-4 rounded-lg border border-border bg-card p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="portal-dashboard-tile-icon">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold tracking-[-0.01em]">{tile.label}</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{tile.description}</span>
        <span className="mt-2 block text-xs text-muted-foreground">{tile.hint}</span>
      </span>

      <ChevronRight
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </Link>
  );
}
