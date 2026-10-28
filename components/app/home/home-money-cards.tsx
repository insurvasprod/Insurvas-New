import Link from "next/link";
import { BadgeDollarSign, BookOpen, Receipt, ShieldCheck, TriangleAlert } from "lucide-react";

import { StatCard, StatRow } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { MoneyFigure } from "@/lib/dashboard/money";
import type { HomeMoneyKey } from "@/lib/dashboard/roleHome";

const ICONS: Record<HomeMoneyKey, typeof Receipt> = {
  statements: Receipt,
  discrepancies: TriangleAlert,
  owed: BadgeDollarSign,
  exposure: ShieldCheck,
  lapse: TriangleAlert,
  persistency: BookOpen,
};

/** Columns in a wide content area: as many as there are cards, up to four (a fourth empty slot reads as missing). */
const WIDE: Record<number, string> = { 1: "@4xl:grid-cols-1", 2: "@4xl:grid-cols-2", 3: "@4xl:grid-cols-3", 4: "@4xl:grid-cols-4" };

/**
 * The money profile's stat row (Sixteen #15: the bookkeeper and money-only plans): the money
 * figures are the day's work, so they take the stat row's place as glossy cards, each opening the
 * view that holds its rows. The first figure that needs a look keeps the one amber footer.
 */
export function HomeMoneyCards({ figures }: { figures: MoneyFigure[] }) {
  if (figures.length === 0) return null;
  const warnAt = figures.findIndex((figure) => figure.tone === "warning" || figure.tone === "danger");
  return (
    <div className="@container">
    <StatRow label="Money" className={cn("grid-cols-1 @lg:grid-cols-2", WIDE[Math.min(figures.length, 4)])}>
      {figures.slice(0, 4).map((figure, index) => (
        <Link key={figure.key} href={figure.href} className="block min-w-0 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
          <StatCard
            icon={ICONS[figure.key]}
            label={figure.label}
            value={figure.value}
            meter={figure.ring ? { value: figure.ring.value, max: figure.ring.max, tone: "good", label: figure.ring.label } : undefined}
            fact={{ label: figure.caption }}
            tone={index === warnAt ? "warn" : "default"}
            className="h-full"
          />
        </Link>
      ))}
    </StatRow>
    </div>
  );
}
