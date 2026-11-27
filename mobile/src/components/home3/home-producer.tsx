import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import type { CalendarAppointment } from "@/components/calendar/month";
import type { PendingAnswer } from "@/components/cases/model";
import { GroupBox, Ring, SmallAvatar } from "@/components/home/parts";
import { initialsOf, longDate, minSec, windowLine } from "@/components/home/when";
import { Between, Button, Card, Chip, F, Failed, Loading, Row, Screen, SectionHead, Strip, T, Tile, type HeaderAction } from "@/components/ui";
import { useCounts } from "@/lib/counts";
import { compactCount } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { CallbacksAnswer, CallingWindowAnswer, WaitingAnswer } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

import { dayKey } from "./logic";
import { Delta, Half, HomePaused, MoneyTile, TileGrid } from "./parts";
import {
  appsWeek, dayRange, dialsWeek, docsNeeded, goalCard, issuedWeek, moneyDelta, pctDelta, scheduleToday, shortDay,
  type PremiumGoalAnswer, type ProducerApp, type ProducerBookAnswer, type ScoreDay,
} from "./producer-logic";
import { ScheduleRow } from "./producer-schedule";

/** The callbacks API answers these roles only (requireFeatureRole on /api/app/callbacks). */
const CALLBACK_ROLES = ["owner", "producer", "assistant"];

/**
 * Board B1 · Home for a producer (and a solo owner on a plan that sells): what to do next, then today's schedule in
 * the customer's time, then this week's numbers and the month's goal. One gold button (Start calling). Every figure
 * comes from the server and opens its list:
 *
 *   hero         GET /api/app/nav/counts (leads ready), /api/app/calling-windows `now` (the window line)
 *   needs you    the nav counts (transfers, callbacks due), /api/app/inbound/waiting (longest wait),
 *                /api/app/callbacks (overdue), /api/app/pending (requirements that need a document),
 *                /api/app/home/producer (policies with a missed payment, and the nearest day the carrier closes one)
 *   schedule     /api/app/callbacks (today's and overdue) with /api/app/calendar (today's appointments on your own
 *                calendar), soonest first
 *   this week    /api/app/scorecard?days=14 (dials), /api/app/applications (submitted, ready to submit),
 *                /api/app/home/producer (issued annual premium by issue date)
 *   the goal     /api/app/goals?kind=premium&for=me against the month's issued annual premium (the web's ring)
 *
 * The four Needs you tiles and the four This week tiles always draw: zero is a figure; a read that fails or that the
 * plan does not include shows "–". Talk time is never recorded (calls go out through the phone's own dialer, with
 * no call provider: no duration is stored), so its tile says so rather than show a made-up figure.
 */
export function HomeProducer() {
  const { me, api } = useSession();
  const { go } = useNav();
  const counts = useCounts();
  const [today] = useState(() => dayKey(Date.now()));
  const role = me?.role ?? "producer";
  const viewer = me?.user.id;
  const parts = callsPartsFor(role, me?.plan?.features);

  const canCallbacks = CALLBACK_ROLES.includes(role) && parts.includes("callbacks");
  const showIncoming = parts.includes("incoming");
  const dials = parts.includes("dialer");
  const range = dayRange(today);

  const callbacks = useLoad(async () => (canCallbacks ? api<CallbacksAnswer>("/api/app/callbacks") : null), [canCallbacks]);
  const appts = useLoad(() => api<{ appointments: CalendarAppointment[] }>(`/api/app/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).catch(() => null), [today]);
  const waiting = useLoad(async () => (showIncoming ? api<WaitingAnswer>("/api/app/inbound/waiting").catch(() => null) : null), [showIncoming], { every: 20_000 });
  const callWin = useLoad(async () => (dials ? api<CallingWindowAnswer>("/api/app/calling-windows").catch(() => null) : null), [dials], { every: 60_000 });
  const pending = useLoad(() => api<PendingAnswer>("/api/app/pending").catch(() => null), []);
  const book = useLoad(() => api<ProducerBookAnswer>("/api/app/home/producer").catch(() => null), []);
  const score = useLoad(() => api<{ rows: ScoreDay[] }>("/api/app/scorecard?days=14").catch(() => null), []);
  const apps = useLoad(() => api<{ applications: ProducerApp[] }>("/api/app/applications").catch(() => null), []);
  const goal = useLoad(() => api<PremiumGoalAnswer>("/api/app/goals?kind=premium&for=me").catch(() => null), []);

  const c = counts.nav?.counts ?? {};
  const line = windowLine(callWin.data?.now);
  const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : compactCount(n));

  const overdue = (callbacks.data?.callbacks ?? []).filter((cb) => cb.status !== "completed" && cb.status !== "cancelled" && (cb.isOverdue || cb.status === "missed")).length;
  const docs = pending.data ? docsNeeded(pending.data.requirements) : null;
  const missed = book.data?.paymentMissed ?? null;
  const items = scheduleToday(callbacks.data?.callbacks ?? [], appts.data?.appointments ?? [], me?.solo ? null : viewer ?? null, today);

  const dialWeek = score.data && viewer ? dialsWeek(score.data.rows, viewer, today) : null;
  const dialDelta = dialWeek ? pctDelta(dialWeek) : null;
  const appWeek = apps.data ? appsWeek(apps.data.applications, today) : null;
  const issued = book.data ? issuedWeek(book.data, today) : null;
  const issuedDelta = issued ? moneyDelta(issued) : null;
  const ring = book.data ? goalCard(book.data, goal.data, today) : null;

  const actions: HeaderAction[] = [
    { icon: "search", label: "Search", onPress: () => router.push("/search") },
    { key: "me", node: <SmallAvatar initials={initialsOf(me?.user.name, me?.user.email)} label={`${me?.user.name ?? "You"}, open the menu`} onPress={() => router.push("/menu")} /> },
  ];

  function refresh() {
    counts.refresh();
    callbacks.refresh();
    appts.reload();
    waiting.reload();
    callWin.reload();
    pending.reload();
    book.reload();
    score.reload();
    apps.reload();
    goal.reload();
  }

  const scheduleBody = canCallbacks && callbacks.loading && !callbacks.data && appts.loading
    ? <Loading rows={3} />
    : canCallbacks && callbacks.error && !callbacks.data && !appts.data
      ? <Failed message={callbacks.error} onRetry={callbacks.reload} />
      : (
        <GroupBox>
          {items.length ? items.slice(0, 6).map((it, i) => <ScheduleRow key={`${it.kind}-${it.kind === "callback" ? it.callback.id : it.appointment.appointmentId}`} item={it} first={i === 0} viewer={viewer} />)
            : <Row first icon="calCheck" iconTone="plain" title="Nothing booked for today" />}
        </GroupBox>
      );

  return (
    <Screen title="Today" sub={longDate()} actions={actions} onRefresh={refresh} refreshing={callbacks.refreshing}>
      <HomePaused />
      {dials ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Card style={{ gap: 12 }}>
            <Between style={{ alignItems: "center" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T kind="ink" style={{ fontFamily: F.s, fontSize: 17, lineHeight: 22 }}>
                  {c["leads.dialer"] === undefined ? "Leads ready to call" : `${compactCount(c["leads.dialer"])} ${c["leads.dialer"] === 1 ? "lead" : "leads"} ready to call`}
                </T>
                {line ? <T kind="mini" style={{ marginTop: 2 }}>{line.text}</T> : null}
              </View>
              {line ? <Chip tone={line.open ? "ok" : "neutral"}>{line.open ? "Open" : "Closed"}</Chip> : null}
            </Between>
            <Button testID="home-start-calling" kind="gold" label="Start calling" icon="phoneOut" onPress={() => go("/calls?part=dialer")} />
          </Card>
        </View>
      ) : null}

      <SectionHead link="All" onLink={() => router.push("/inbox")}>Needs you</SectionHead>
      <Strip>
        <Tile testID="home-tile-transfers" width={150} icon="phoneIn" label="Transfers waiting" value={num(showIncoming ? c["leads.inbound"] : null)}
          detail={waiting.data?.items.length ? `Longest ${minSec(Math.max(...waiting.data.items.map((w) => w.waitSeconds)))}` : undefined}
          onPress={showIncoming ? () => go("/calls?part=incoming") : undefined} />
        <Tile testID="home-tile-callbacks" width={150} icon="calCheck" label="Callbacks due" value={num(canCallbacks ? c["sell.callbacks"] : null)}
          detail={overdue ? <Chip tone="warn">{`${overdue} overdue`}</Chip> : undefined}
          onPress={canCallbacks ? () => go("/calls?part=callbacks") : undefined} />
        <Tile testID="home-tile-cases" width={150} icon="fileCheck" label={docs && docs.count > 1 ? "Cases need a doc" : "Case needs a doc"} value={num(docs?.count)}
          detail={docs?.detail ?? undefined} onPress={docs ? () => router.push("/cases" as never) : undefined} />
        <Tile testID="home-tile-payment-missed" width={150} icon="buoy" label="Payment missed" value={num(missed?.count)}
          detail={missed?.count && missed.saveBy ? `Save by ${shortDay(missed.saveBy)}` : undefined}
          onPress={missed ? () => router.push("/retention" as never) : undefined} />
      </Strip>

      <SectionHead link="Calendar" onLink={() => router.push("/calendar")}>Schedule</SectionHead>
      {scheduleBody}

      <SectionHead link="Activity" onLink={() => router.push("/reports/activity" as never)}>This week</SectionHead>
      <TileGrid>
        <Half>
          <Tile testID="home-week-dials" label="Dials" value={num(dialWeek?.now)}
            detail={dialDelta ? <Delta strong={dialDelta.strong} rest="vs last week" good={dialDelta.good} /> : undefined}
            onPress={dialWeek ? () => router.push("/reports/activity" as never) : undefined} />
        </Half>
        <Half>
          <Tile testID="home-week-talk" label="Talk time" value="–" detail="Not recorded on calls yet" />
        </Half>
        <Half>
          <Tile testID="home-week-apps" label="Applications" value={num(appWeek?.submitted)}
            detail={appWeek?.ready ? `${appWeek.ready} ready to submit` : undefined}
            onPress={appWeek ? () => router.push("/application" as never) : undefined} />
        </Half>
        <Half>
          {issued ? (
            <MoneyTile testID="home-week-issued" label="Issued premium" cents={issued.now}
              detail={issuedDelta ? <Delta strong={issuedDelta.strong} rest="vs last week" good={issuedDelta.good} /> : undefined}
              onPress={() => router.push("/book" as never)} />
          ) : (
            <Tile testID="home-week-issued" label="Issued premium" value="–" />
          )}
        </Half>
      </TileGrid>

      {ring ? (
        <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
          <Card onPress={() => router.push("/book" as never)} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Ring pct={ring.pct} size={76} label={ring.label} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T kind="ink" style={{ fontFamily: F.s }}>{ring.title}</T>
              <T kind="small" style={{ fontSize: 14, lineHeight: 19 }}>{ring.line}</T>
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}
