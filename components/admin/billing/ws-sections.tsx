import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { formatCentsAsCurrency } from "@/lib/money";
import { needsFor, type NeedRow, type NeedTone } from "@/lib/billingWorkspace/needs";
import { comingUp, justHappened, workspaceFigures, type HappenedItem } from "@/lib/billingWorkspace/overview";
import { billingNeedsInput } from "@/lib/billingWorkspace/reads";
import { cn } from "@/lib/utils";
import { WsPanel, WsPanelError, agoWords, settlePanel } from "./ws-panel";

type Viewer = { id: string; role: AdminRole };

/** The request's clock, read once beside the rows it dates. */
function readClock(): number {
  return Date.now();
}

const n = (value: number) => value.toLocaleString("en-US");
const rowLink = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground no-underline last:border-b-0 hover:bg-[var(--hover-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const rowPlain = "flex min-h-11 items-center gap-3 border-b border-border px-4 py-2 text-sm text-foreground last:border-b-0";
const Chevron = () => <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;

/* ── Figures ─────────────────────────────────────────────────────────────────────────────────── */

/** The five figures with their trend lines (billing-r2 screen 1). Fails as one strip, said plainly. */
export async function WsFigures({ role }: { role: AdminRole }) {
  const figures = await settlePanel("workspace figures", () => workspaceFigures());
  if (!figures) {
    return <WsPanelError title="Billing figures" />;
  }
  const open = (href: string) => (canOpenAdminHref(role, href) ? href : undefined);
  const { mrr, collected, overdue, trialsEnding, refunds } = figures;
  const collectedShare = collected.invoicedCents > 0 ? Math.round((collected.cents / collected.invoicedCents) * 100) : null;
  return (
    <StatStrip label="Billing figures">
      <StatTile
        label="MRR · live"
        value={mrr.cents === null ? "—" : formatCentsAsCurrency(mrr.cents)}
        footnote={mrr.cents === null ? "prices couldn't be read" : `${n(mrr.active)} active · ${n(mrr.plans)} ${mrr.plans === 1 ? "plan" : "plans"}`}
        labelTitle="Live, at list price: each Active, Past due or Cancelled-in-period subscription's plan price a month. The line is the nightly snapshot over 13 weeks."
        trend={mrr.trend.length > 1 ? { points: mrr.trend, tone: "primary", placement: "under" } : undefined}
        href={open("/admin/revenue")}
      />
      <StatTile
        label="Collected this month"
        value={formatCentsAsCurrency(collected.cents)}
        footnote={collectedShare === null ? "nothing invoiced yet this month" : `${collectedShare}% of ${formatCentsAsCurrency(collected.invoicedCents)} invoiced`}
        labelTitle="Paid invoices raised this calendar month (UTC). The line is what was paid in each of the last six months."
        trend={{ points: collected.trend, tone: "primary", placement: "under" }}
        href={open("/admin/invoices")}
      />
      <StatTile
        label="Overdue"
        value={n(overdue.count)}
        footnote={overdue.count ? `${formatCentsAsCurrency(overdue.owedCents)} owed` : "nothing overdue"}
        labelTitle="Invoices past their due date and unpaid. The line is how many were overdue at the end of each of the last eight weeks."
        trend={{ points: overdue.trend, tone: "neutral", placement: "under" }}
        href={open("/admin/invoices?lens=overdue")}
      />
      <StatTile
        label="Trials ending · 7 days"
        value={n(trialsEnding.count)}
        footnote={trialsEnding.count ? `${n(trialsEnding.noCard)} with no card` : "none this week"}
        labelTitle="Trials whose end falls in the next seven days, overdue ones included. The line is how many end on each of the next seven days."
        trend={{ points: trialsEnding.trend, tone: "neutral", placement: "under" }}
        href={open("/admin/trials?ends=week")}
      />
      <StatTile
        label="Refunds waiting"
        value={n(refunds.waiting)}
        footnote={refunds.waiting ? "need a second admin" : "none waiting"}
        labelTitle="Credit notes waiting for approval. The line is how many were raised in each of the last eight weeks."
        trend={{ points: refunds.trend, tone: "neutral", placement: "under" }}
        href={open("/admin/credit-notes?lens=approval")}
      />
    </StatStrip>
  );
}

/** A figure still on its way: a skeleton the size of a number. */
function FigureSkeleton() {
  return <span aria-hidden="true" className="m-skel inline-block h-6 w-16 rounded-md" />;
}

export function WsFiguresLoading() {
  const pending = <FigureSkeleton />;
  return (
    <StatStrip label="Billing figures">
      {["MRR · live", "Collected this month", "Overdue", "Trials ending · 7 days", "Refunds waiting"].map((label) => (
        <StatTile key={label} label={label} value={pending} reserveFootnote />
      ))}
    </StatStrip>
  );
}

/* ── Needs you ───────────────────────────────────────────────────────────────────────────────── */

const NEED_CHIP: Record<NeedTone, { tone: StatusTone; label: string }> = {
  failing: { tone: "danger", label: "Failing" },
  look: { tone: "warning", label: "Look" },
  unknown: { tone: "neutral", label: "Couldn't check" },
};

export async function WsNeeds({ viewer }: { viewer: Viewer }) {
  const input = await billingNeedsInput(viewer.id, viewer.role);
  const rows: NeedRow[] = needsFor(input, (href) => canOpenAdminHref(viewer.role, href));
  const waiting = rows.filter((row) => row.tone !== "unknown").length;
  return (
    <WsPanel title="Needs you" count={waiting} note="worst first · each opens its page, filtered">
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-foreground">Nothing needs you</p>
          <p className="m-0 max-w-[44ch] text-xs text-muted-foreground">Payments, invoices, trials and refunds are all where they should be.</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => (
            <li key={row.key}>
              <Link href={row.href} className={rowLink}>
                <span className="w-40 shrink-0 truncate font-semibold xl:w-52" title={row.title}>{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.detail}>{row.detail}</span>
                <StatusChip tone={NEED_CHIP[row.tone].tone}>{NEED_CHIP[row.tone].label}</StatusChip>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WsPanel>
  );
}

/* ── Coming up ───────────────────────────────────────────────────────────────────────────────── */

export async function WsComingUp({ role }: { role: AdminRole }) {
  const data = await settlePanel("coming up", () => comingUp());
  if (!data) return <WsPanelError title="Coming up · 7 days" />;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (iso: string) => { const d = new Date(iso); return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const offers = data.offersStarting;
  const lines: { key: string; label: string; value: string; href: string }[] = [
    { key: "renewals", label: "Renewals", value: data.renewals.count ? `${n(data.renewals.count)}${data.renewals.cents !== null ? ` · ${formatCentsAsCurrency(data.renewals.cents)}` : ""}` : "None", href: "/admin/subscriptions?lens=renews" },
    { key: "trials", label: "Trials ending", value: data.trialsEnding ? n(data.trialsEnding) : "None", href: "/admin/trials?ends=week" },
    { key: "queued", label: "Plan changes queued", value: data.queued ? n(data.queued) : "None", href: "/admin/subscriptions?lens=queued" },
    { key: "coupons", label: "Coupons expiring", value: data.couponsExpiring ? n(data.couponsExpiring) : "None", href: "/admin/coupons" },
    { key: "offers", label: "Offers starting", value: offers.length === 0 ? "None" : offers.length === 1 ? `${offers[0].name} · ${day(offers[0].startsAt)}` : `${n(offers.length)} · first ${day(offers[0].startsAt)}`, href: "/admin/offers" },
  ];
  return (
    <WsPanel title="Coming up · 7 days">
      <ul className="m-0 list-none p-0">
        {lines.map((line) => {
          const body = (
            <>
              <span className="min-w-0 flex-1 truncate">{line.label}</span>
              <span className={cn("truncate tabular-nums", line.value === "None" ? "text-muted-foreground" : "text-foreground")}>{line.value}</span>
            </>
          );
          return (
            <li key={line.key}>
              {canOpenAdminHref(role, line.href) ? <Link href={line.href} className={rowLink}>{body}<Chevron /></Link> : <div className={rowPlain}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </WsPanel>
  );
}

/* ── Just happened ───────────────────────────────────────────────────────────────────────────── */

const DOT: Record<HappenedItem["tone"], string> = {
  good: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
  bad: "bg-[var(--error)]",
  info: "bg-[var(--info)]",
};

export async function WsHappened({ viewer }: { viewer: Viewer }) {
  const read = await settlePanel("just happened", async () => ({ items: await justHappened(viewer), now: readClock() }));
  if (!read) return <WsPanelError title="Just happened" className="flex-1" />;
  const { items, now } = read;
  return (
    <WsPanel title="Just happened" note="from the audit log and the provider" className="min-h-0 flex-1">
      {items.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-xs text-muted-foreground">Nothing has happened in billing yet.</p>
      ) : (
        <ul className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
          {items.map((item) => {
            const body = (
              <>
                <span className={cn("size-1.5 shrink-0 rounded-full", DOT[item.tone])} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span>
                <time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground" title={item.at}>{agoWords(item.at, now)}</time>
              </>
            );
            return <li key={item.id}>{item.href && canOpenAdminHref(viewer.role, item.href) ? <Link href={item.href} className={rowLink}>{body}</Link> : <div className={rowPlain}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </WsPanel>
  );
}
