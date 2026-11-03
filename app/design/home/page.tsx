import Link from "next/link";
import { notFound } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { HomeAttention } from "@/components/app/home/home-attention";
import { HomeSetup, HomeShortcuts, ShortcutLink, moduleIcon } from "@/components/app/home/home-extras";
import { HomeKpis } from "@/components/app/home/home-kpis";
import { HomeMoneyCards } from "@/components/app/home/home-money-cards";
import { HomeLowerRow, HomeMainRow } from "@/components/app/home/home-rows";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { setupChecklistForState } from "@/lib/dashboard/checklist";
import { attentionItems, kpiCards, type AttentionItem, type HomeRole } from "@/lib/dashboard/homeView";
import { SAMPLE_NOW, SAMPLE_ZONE, sampleCallbacks, sampleMoney, sampleToday } from "@/lib/dashboard/homeSample";
import { firstOpenable, HOME_SECTIONS, resolveRoleHome } from "@/lib/dashboard/roleHome";
import { greeting, longDate } from "@/lib/dashboard/todayMath";
import { visibleDashboardTiles } from "@/lib/dashboard/tiles";
import { menuFeatureKeys } from "@/lib/menu/definition";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { cn } from "@/lib/utils";

export const metadata = { title: "Home · Insurvas design system" };

const ROLES: Array<{ key: HomeRole; label: string; tenantRole: TenantRole }> = [
  { key: "owner", label: "Owner", tenantRole: "owner" },
  { key: "manager", label: "Manager", tenantRole: "producer" },
  { key: "producer", label: "Producer", tenantRole: "producer" },
  { key: "setter", label: "Setter", tenantRole: "setter" },
  { key: "assistant", label: "Assistant", tenantRole: "assistant" },
  { key: "bookkeeper", label: "Bookkeeper", tenantRole: "bookkeeper" },
];

const STATES = ["busy", "quiet", "new"] as const;

/**
 * The Home dashboard, every role, from illustrative data (tasks/home-dashboard-plan.md). It draws
 * the same components the dashboard page streams, under the same role gates (resolveRoleHome with
 * every feature on), so a layout change is checked here without an agency. Development only.
 *
 *   ?role=owner|manager|producer|setter|assistant|bookkeeper   ?state=busy|quiet|new
 */
export default async function HomeDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const role = ROLES.find((item) => item.key === params.role) ?? ROLES[0];
  const state = STATES.find((item) => item === params.state) ?? "busy";

  const features = [...new Set(menuFeatureKeys())];
  const home = resolveRoleHome(features, role.tenantRole, { code: "pro", features });
  const open = (keys: readonly string[]) => firstOpenable(keys, features, role.tenantRole);
  const agencyView = role.key === "owner";
  const noMoney = role.key === "manager";

  const today = sampleToday(state === "quiet" ? 0.35 : state === "new" ? 0 : 1);
  if (state !== "busy") {
    today.needs = { ...today.needs, transfersWaiting: 0, slaBreaching: 0, callbacksOverdue: 0, lapsing: 0, licences: { expired: 0, expiring: 0, states: [] } };
    today.closeOut = state === "new" ? null : { showed: 12, noShow: 2, awaiting: 0 };
  }
  if (state === "new") {
    today.series = today.series.map((day) => ({ ...day, dials: null, contacts: null }));
    today.appointmentsTodayList = [];
    today.appointmentsToday = 0;
    today.appointmentsWeek = 0;
    today.insights = null;
    today.policies30 = { count: 0, premiumCents: 0 };
  }
  if (!agencyView && today.insights) today.insights = { ...today.insights, leaders: null };

  const needHref = (key: string) => home.needs.find((need) => need.key === key)?.href ?? null;
  const attention = attentionItems(today, { transfers: needHref("transfers"), callbacks: needHref("callbacks"), lapse: needHref("lapse"), licences: needHref("licences") });
  const shown = new Set(home.sections);
  const activityHref = open(HOME_SECTIONS.activity.opens);
  const preview: AttentionItem[] = state === "busy" && shown.has("closeOut") && activityHref
    ? [{ key: "closeOut", count: 4, label: "to close out", tone: "warning", href: activityHref }, ...(shown.has("pending") ? [{ key: "pending", count: 6, label: "pending cases", detail: "2 overdue", tone: "danger" as const, href: "/app/pending" }] : [])]
    : [];

  const money = noMoney || home.money.length === 0 ? null : sampleMoney().filter((figure) => home.money.some((item) => item.key === figure.key));
  const kpis = home.moneyAs === "strip" ? [] : kpiCards(today, home.figures, role.key);
  const checklist = setupChecklistForState(state === "new" ? "not_started" : "complete", state === "new" ? { finished: false } : {}, { features });
  const modules = visibleDashboardTiles(features, role.tenantRole);
  const [primary, ...secondary] = home.actions;

  return (
    <main className="portal-agent min-h-screen bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto mb-6 flex max-w-[1192px] flex-wrap items-center gap-2 border-b border-border pb-4 text-sm">
        <span className="mr-2 font-semibold">Home preview</span>
        {ROLES.map((item) => (
          <Link key={item.key} href={`?role=${item.key}&state=${state}`} className={cn("rounded-md px-2.5 py-1 no-underline", item.key === role.key ? "bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)]" : "text-muted-foreground hover:text-foreground")}>{item.label}</Link>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {STATES.map((item) => (
          <Link key={item} href={`?role=${role.key}&state=${item}`} className={cn("rounded-md px-2.5 py-1 capitalize no-underline", item === state ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>{item}</Link>
        ))}
        <span className="flex-1" />
        <ThemeToggle />
      </div>

      <div className="mx-auto flex w-full max-w-[1192px] flex-col gap-4">
        <PageHeader
          title={`${greeting(SAMPLE_NOW, SAMPLE_ZONE)}, Rion`}
          description={longDate(SAMPLE_NOW, SAMPLE_ZONE)}
          actions={
            <>
              {secondary.map((action) => <Button key={action.href} asChild variant="outline"><Link href={action.href}>{action.label}</Link></Button>)}
              {primary && <Button asChild><Link href={primary.href}>{primary.label}</Link></Button>}
            </>
          }
        />
        {state === "new" && shown.has("setup") && !checklist.complete && <HomeSetup checklist={checklist} />}
        {home.moneyAs !== "strip" && <HomeAttention items={attention} preview={preview} />}
        {home.moneyAs === "strip" && money ? (
          <HomeMoneyCards figures={money} />
        ) : (
          <HomeKpis cards={kpis} />
        )}
        <HomeMainRow
          today={today}
          callbacks={home.nextCallbackHref ? (state === "new" ? [] : sampleCallbacks()) : null}
          links={{ activity: activityHref, appointments: shown.has("appointments") ? open(HOME_SECTIONS.appointments.opens) : null, callbacks: home.nextCallbackHref, calendar: open(HOME_SECTIONS.appointments.opens) }}
          showActivity={shown.has("activity")}
          agencyView={agencyView}
        />
        {home.moneyAs !== "strip" && (
          <HomeLowerRow
            money={money}
            upgrade={null}
            leaders={shown.has("team") ? today.insights?.leaders ?? null : null}
            teamHref={activityHref}
          />
        )}
        {modules.length > 0 && (
          <HomeShortcuts>
            {modules.map((tile, index) => (
              <ShortcutLink key={tile.key} icon={moduleIcon(tile.icon)} label={tile.label} href={tile.path} figure={agencyView && state !== "new" ? String([12, 3, 186, 41, 7, 9, 64, 18, 2, 5, 11, 4][index % 12]) : undefined} />
            ))}
          </HomeShortcuts>
        )}
      </div>
    </main>
  );
}
