import { Suspense } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { scopeFor } from "@/lib/agency/visibility";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { firstOpenable, HOME_SECTIONS } from "@/lib/dashboard/roleHome";
import { dayKey } from "@/lib/dashboard/views/sales";
import { figuresBy, loadCompare, periodPair, type Metric, type Preset } from "@/lib/dashboard/compare";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AgencyPage } from "@/components/app/agency/agency-page";
import { PeoplePicker, PeriodControls, ScopePicker } from "@/components/app/agency/compare/compare-controls";
import { ComparePeople, ComparePeriods, PeriodWords, type CompareLinks } from "@/components/app/agency/compare/compare-view";
import { PageLoading } from "@/components/ui/page-loading";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Home › Agency › Compare (owner 2026-11-07, "Build A and B" on the Compare mockups): any two periods side by side.
 * "Periods" (A) is the agency, or one person, this period against the last; "People" (B) puts up to four people side
 * by side on one pair. The same people as the agency dashboard may open it (owner, admins, the bookkeeper, a manager
 * for his reports); money shows only to the first three. Every choice is in the address.
 */
const PRESET_KEYS: readonly Preset[] = ["day", "week", "month", "quarter", "ytd", "custom"];
const METRICS: readonly Metric[] = ["premium", "policies", "dials"];
/** Pages the cards open, as data (lib/menu: no menu key inside a conditional). */
const COMPARE_PAGES = { policies: ["book.policies"], applications: ["sell.applications"], producers: ["team.producers"] } as const;

type Search = { tab?: string; preset?: string; af?: string; at?: string; bf?: string; bt?: string; person?: string; people?: string; metric?: string; cols?: string };

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  const guard = await guardPage("agency_dashboard");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Compare" description="Any two periods side by side, for the agency and each person." />;
  const manager = guard.context.memberRole === "manager";
  if (!(actAsPage(guard, ["owner", "bookkeeper"]) || manager)) {
    return <RoleGateNotice featureLabel="Compare" detail="The owner, admins, managers and the bookkeeper can compare periods and people." />;
  }
  const context = guard.context;
  const [query, switches, scope, solo, zone] = await Promise.all([
    searchParams,
    loadFeatureSwitches(),
    scopeFor(context),
    isSoloWorkspace(context.tenantId),
    getWorkspaceTimezone(context.tenantId).catch(() => null),
  ]);
  const available = applyKillSwitches(guard.entitlement.features, switches, context.tenantId);
  const open = (keys: readonly string[]) => firstOpenable(keys, [...available], context.role, solo);
  const links: CompareLinks = {
    policies: open(COMPARE_PAGES.policies),
    applications: open(COMPARE_PAGES.applications),
    activity: open(HOME_SECTIONS.activity.opens),
    producers: open(COMPARE_PAGES.producers),
  };
  const money = !manager;
  const timeZone = zone ?? "America/New_York";
  // eslint-disable-next-line react-hooks/purity -- a server render: "today" is as of this request.
  const today = dayKey(Date.now(), timeZone);
  const preset = PRESET_KEYS.includes(query.preset as Preset) ? (query.preset as Preset) : "month";
  const pair = periodPair(preset, today, { a: { from: query.af, to: query.at }, b: { from: query.bf, to: query.bt } });
  const tab = query.tab === "people" ? "people" : "periods";
  const metric = METRICS.includes(query.metric as Metric) ? (query.metric as Metric) : money ? "premium" : "policies";
  const base = "/app/agency/compare";
  const keep = new URLSearchParams(Object.entries(query).filter(([key, value]) => value && key !== "tab") as [string, string][]);
  const tabHref = (key: string) => {
    const next = new URLSearchParams(keep);
    if (key === "people") next.set("tab", "people");
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <AgencyPage
      step="compare"
      info="Any two periods side by side: the whole agency or one person on Periods, up to four people on People. Every figure opens the rows behind it."
      lead={<ViewTabs label="Compare by" value={tab} tabs={[{ key: "periods", label: "Periods", href: tabHref("periods") }, { key: "people", label: "People", href: tabHref("people") }]} />}
      actions={<PeriodWords pair={pair} />}
    >
      {/* Only new periods (or the other tab) re-read the figures behind a skeleton. A person and the people compared keep
          the page on screen, dimmed, while the server reshapes the same figures; the chart's figure and the table's
          columns switch in the page with no round trip (compare-controls.tsx). */}
      <Suspense key={`${tab}-${pair.a.from}-${pair.a.to}-${pair.b.from}-${pair.b.to}`} fallback={<PageLoading header={false} />}>
        <CompareBody tab={tab} pair={pair} viewer={{ tenantId: context.tenantId, userId: context.userId, role: context.memberRole ?? context.role, scope, zone: timeZone }} person={query.person ?? null} people={query.people ?? null} metric={metric} cols={query.cols ?? null} money={money} links={links} />
      </Suspense>
    </AgencyPage>
  );
}

async function CompareBody({ tab, pair, viewer, person, people, metric, cols, money, links }: {
  tab: "periods" | "people";
  pair: ReturnType<typeof periodPair>;
  viewer: Parameters<typeof loadCompare>[0];
  person: string | null;
  people: string | null;
  metric: Metric;
  cols: string | null;
  money: boolean;
  links: CompareLinks;
}) {
  const { events, names } = await loadCompare(viewer, pair);
  // Everyone with a call, quote, application or policy in either period, busiest first, for the pickers.
  const now = figuresBy(events, pair.a);
  const weight = (id: string) => (money ? now.by.get(id)?.premiumCents ?? 0 : now.by.get(id)?.issued ?? 0) * 1000 + (now.by.get(id)?.dials ?? 0);
  const options = [...names.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => weight(y.id) - weight(x.id) || x.name.localeCompare(y.name));
  const focused = person && names.has(person) ? person : null;
  const chosen = (people ? people.split(",").filter((id) => names.has(id)) : options.slice(0, 4).map((option) => option.id)).slice(0, 4);

  return (
    <div data-page-content className="flex min-w-0 flex-col gap-4 pb-4 m-content-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><PeriodControls preset={pair.preset} a={pair.a} b={pair.b} /></div>
        {tab === "periods" && <ScopePicker people={options} person={focused} />}
      </div>
      {tab === "people" && <PeoplePicker people={options} chosen={chosen} />}
      {tab === "periods"
        ? <ComparePeriods events={events} names={names} pair={pair} person={focused} metric={metric} money={money} links={links} cols={cols ? cols.split(",") : null} />
        : <ComparePeople events={events} names={names} pair={pair} chosen={chosen} money={money} links={links} />}
    </div>
  );
}
