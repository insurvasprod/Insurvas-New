import Link from "next/link";
import { CalendarCheck, CalendarClock, CircleCheck, DollarSign, ListChecks, ListOrdered, PhoneCall, PhoneOutgoing } from "lucide-react";

import { LinkArrow } from "@/components/ui/link-arrow";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { KpiCard, KpiIcon } from "@/lib/dashboard/homeView";

const ICONS: Record<KpiIcon, typeof DollarSign> = {
  dollar: DollarSign,
  calendar: CalendarCheck,
  phone: PhoneCall,
  dial: PhoneOutgoing,
  queue: ListOrdered,
  check: ListChecks,
  booked: CalendarClock,
  show: CircleCheck,
};

/** Columns in a wide content area: as many as there are cards, up to four (a fourth empty slot reads as missing). */
const WIDE: Record<number, string> = { 1: "@4xl:grid-cols-1", 2: "@4xl:grid-cols-2", 3: "@4xl:grid-cols-3", 4: "@4xl:grid-cols-4" };

/**
 * The stat row under the header: the role's four figures as v3 glossy cards (UI-CONSISTENCY §4a).
 * A card is a way into the page behind its number: the whole card links there, unless it carries
 * its own action (Start calling), which is then the link.
 */
export function HomeKpis({ cards }: { cards: KpiCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="@container">
    <StatRow label="Today's figures" className={cn("grid-cols-1 @lg:grid-cols-2", WIDE[Math.min(cards.length, 4)])}>
      {cards.map((card) => {
        const body = (
          <StatCard
            icon={ICONS[card.icon]}
            label={card.label}
            period={card.period}
            value={card.value}
            unit={card.unit}
            delta={card.delta}
            meter={card.meter}
            tone={card.tone}
            fact={card.fact}
            className="h-full"
            action={card.action ? <LinkArrow asChild className="text-xs"><Link href={card.action.href}>{card.action.label}</Link></LinkArrow> : undefined}
          />
        );
        if (card.action) return <div key={card.key} className="min-w-0">{body}</div>;
        return (
          <Link
            key={card.key}
            href={card.href}
            className="block min-w-0 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
          >
            {body}
          </Link>
        );
      })}
    </StatRow>
    </div>
  );
}
