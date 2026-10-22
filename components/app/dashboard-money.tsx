import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CountUp } from "@/components/ui/count-up";
import { SectionLoading } from "@/components/ui/page-states";
import { Ring } from "@/components/ui/ring";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import type { DashboardMoney, MoneyFigure } from "@/lib/dashboard/money";

/**
 * Money and retention on the dashboard (LA-4.18, Sixteen #15). Every figure links to the page that
 * lists its rows (LA-4.20). Two shapes, because a page has one strip (UI-CONSISTENCY §4):
 *
 *   · on a money profile (the Ledger plan, the bookkeeper) the figures ARE the strip;
 *   · otherwise the day's figures hold the strip, and these are one TableCard of linked cells
 *     beside "Needs you today", drawn the same way.
 *
 * The reads stream (lib/dashboard/money.ts): the page paints without waiting for them.
 */
const TONE_INK = { good: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]" } as const;

function Caption({ figure }: { figure: MoneyFigure }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {figure.ring && <Ring value={figure.ring.value} max={figure.ring.max} size={18} label={figure.ring.label} tone="primary"><></></Ring>}
      <span className="line-clamp-2">{figure.caption}</span>
    </span>
  );
}

export async function DashboardMoneyStrip({ money }: { money: Promise<DashboardMoney> }) {
  const { figures } = await money;
  if (!figures.length) return null;
  return (
    <StatStrip label="Money">
      {figures.map((figure) => (
        <StatTile
          key={figure.key}
          label={figure.label}
          value={figure.value}
          valueTone={figure.tone === "danger" ? "danger" : figure.tone === "warning" ? "warning" : undefined}
          reserveFootnote
          footnote={<Caption figure={figure} />}
          action={<Link href={figure.href} aria-label={`Open ${figure.label.toLowerCase()}`} className="font-semibold text-foreground no-underline hover:underline">Open</Link>}
        />
      ))}
    </StatStrip>
  );
}

export async function DashboardMoneyList({ money }: { money: Promise<DashboardMoney> }) {
  const { figures } = await money;
  if (!figures.length) return null;
  return (
    <TableCard title="Money and retention">
      <ul className="m-0 grid list-none grid-cols-1 gap-px overflow-hidden border-t border-border bg-border p-0 sm:grid-cols-2 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none">
        {figures.map((figure) => (
          <li key={figure.key} className="bg-card">
            <Link href={figure.href} aria-label={`${figure.label}: ${figure.value}. Open the rows behind it`} className="m-row group flex items-center gap-3 px-4 py-3 text-inherit no-underline">
              <span className={`m-figure text-2xl font-semibold leading-none tracking-[-0.03em] tabular-nums ${figure.tone === "danger" ? TONE_INK.danger : "text-foreground"}`}>
                {/\d/.test(figure.value) ? <CountUp text={figure.value} /> : figure.value}
              </span>
              <span className="min-w-0 flex-1">
                {/* Two lines rather than an ellipsis: at five cells a row, "Statements to review"
                    and "Chargeback exposure" were cut to "Statements to revi…". */}
                <span className="line-clamp-2 block text-xs font-semibold text-foreground">{figure.label}</span>
                <span className={`mt-0.5 block text-xs ${figure.tone && figure.tone !== "danger" ? TONE_INK[figure.tone] : "text-muted-foreground"}`}><Caption figure={figure} /></span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </TableCard>
  );
}

/**
 * The one upgrade tile (Sixteen #15): a single actionable line in a fixed place under the strip,
 * driven by the agent's own data. It renders only when that data is above zero; the plan, role and
 * feature conditions were settled by the role home before this was asked for.
 */
export async function DashboardUpgrade({ money, featureHref, rowsHref }: { money: Promise<DashboardMoney>; featureHref: string; rowsHref: string }) {
  const { exposurePolicies } = await money;
  if (!exposurePolicies) return null;
  const count = exposurePolicies.toLocaleString("en-US");
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3 text-sm text-[var(--info-ink)]">
      <span className="min-w-0 flex-1">
        {count} of your {exposurePolicies === 1 ? "policies is" : "policies are"} inside {exposurePolicies === 1 ? "its" : "their"} chargeback window. Lapse risk would flag these before they lapse.
      </span>
      <Link href={rowsHref} className="font-semibold underline">See the {count}</Link>
      <Link href={featureHref} className="font-semibold underline">What Lapse risk adds</Link>
    </div>
  );
}

export function DashboardMoneyLoading({ as }: { as: "strip" | "list" }) {
  return as === "strip"
    ? <StatStrip label="Money"><SectionLoading rows={1} columns={4} label="Loading money figures" /></StatStrip>
    : <TableCard title="Money and retention"><SectionLoading rows={1} columns={4} label="Loading money figures" /></TableCard>;
}
