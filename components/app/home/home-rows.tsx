import type { MoneyFigure } from "@/lib/dashboard/money";
import { activityView, scheduleItems, type DueCallback, type HomeToday } from "@/lib/dashboard/homeView";
import { cn } from "@/lib/utils";

import { HomeActivity } from "./home-activity";
import { HomeMoney, HomeTeam } from "./home-money";
import { HomeSchedule } from "./home-schedule";

/*
 * The two content rows of Home, from resolved data. The dashboard page awaits its streamed reads
 * and renders these; `/design/home` renders them from sample data. Each row is a 12-column grid
 * (v3: "12-column grid for dashboards"): the wide panel takes 8, the narrow one 4, and either
 * takes the full row when the other has nothing to show.
 */

export type MainRowLinks = {
  activity: string | null;
  appointments: string | null;
  callbacks: string | null;
  /** The calendar, where "Today" opens; falls back to callbacks. */
  calendar: string | null;
};

/** Calls over 14 days, beside today's schedule. */
export function HomeMainRow({ today, callbacks, links, showActivity, agencyView }: { today: HomeToday | null; callbacks: DueCallback[] | null; links: MainRowLinks; showActivity: boolean; agencyView: boolean }) {
  const activity = showActivity ? activityView(today) : null;
  const scheduleWanted = Boolean(links.appointments || links.callbacks);
  const schedule = scheduleItems(today?.appointmentsTodayList ?? null, callbacks, { appointments: links.appointments, callbacks: links.callbacks });
  const scheduleLink = links.calendar ?? links.callbacks;
  // Alone on its row, an empty schedule is a large empty card: "All caught up" above already says it.
  if (!activity && (!scheduleWanted || schedule.total === 0)) return null;
  return (
    <div className="@container"><div className="grid grid-cols-1 gap-3 @3xl:grid-cols-12">
      {/* 7 + 5 in a laptop-wide content area, 8 + 4 from 1152px of it (container queries: the sidebar takes its share): the schedule needs room for a name and its chip. */}
      {activity && <HomeActivity view={activity} href={links.activity} className={cn(scheduleWanted ? "@3xl:col-span-7 @6xl:col-span-8" : "@3xl:col-span-12")} />}
      {scheduleWanted && (
        <HomeSchedule
          items={schedule.items}
          total={schedule.total}
          zone={today?.zone ?? "America/New_York"}
          showAgent={agencyView}
          link={scheduleLink ? { label: links.calendar ? "Calendar" : "Callbacks", href: scheduleLink } : null}
          className={cn(activity ? "@3xl:col-span-5 @6xl:col-span-4" : "@3xl:col-span-12")}
        />
      )}
    </div></div>
  );
}

/** Money and retention, beside the team's standings. */
export function HomeLowerRow({
  money,
  upgrade,
  leaders,
  teamHref,
}: {
  money: MoneyFigure[] | null;
  upgrade: { policies: number; featureHref: string; rowsHref: string } | null;
  leaders: NonNullable<NonNullable<HomeToday["insights"]>["leaders"]> | null;
  teamHref: string | null;
}) {
  const hasMoney = Boolean(money?.length) || Boolean(upgrade);
  const hasTeam = Boolean(leaders?.length);
  if (!hasMoney && !hasTeam) return null;
  return (
    <div className="@container"><div className="grid grid-cols-1 gap-3 @3xl:grid-cols-12">
      {hasMoney && <HomeMoney figures={money ?? []} upgrade={upgrade} className={hasTeam ? "@3xl:col-span-7 @6xl:col-span-8" : "@3xl:col-span-12"} />}
      {hasTeam && leaders && <HomeTeam leaders={leaders} href={teamHref} className={hasMoney ? "@3xl:col-span-5 @6xl:col-span-4" : "@3xl:col-span-12"} />}
    </div></div>
  );
}
