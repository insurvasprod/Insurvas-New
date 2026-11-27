import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import type { CalendarAppointment } from "@/components/calendar/month";
import { GroupBox, Ring } from "@/components/home/parts";
import { longDate } from "@/components/home/when";
import { Button, Card, Chip, F, Failed, Loading, Row, Screen, SectionHead, T, TextLink, Tile, type HeaderAction } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { setterLines, setterWeek, type GoalAnswer, type ScoreRow } from "@/lib/setter-week";
import { useLoad } from "@/lib/use-load";

import { Half, HomePaused, TileGrid } from "./parts";
import { setterAppointments, setterRange } from "./setter-appointments";

/**
 * Board B3 · Home for a setter, in the board's order: the week's booking ring (always: the target from the
 * `booked` goal, or the week's count when no target is set; an empty ring while loading or after a failed read), Serve next lead, the four Today tiles (always;
 * "–" until the scorecard answers), then "Appointments you set" with Scheduled / Showed chips.
 * Every figure is the server's: GET /api/app/scorecard (own rows), /api/app/goals, /api/app/calendar.
 */
export function HomeSetter() {
  const { api, me } = useSession();
  const { go } = useNav();
  const [now] = useState(() => Date.now());
  const score = useLoad(() => api<{ rows: ScoreRow[] }>("/api/app/scorecard?days=30"), []);
  const goal = useLoad(() => api<GoalAnswer>("/api/app/goals?kind=booked&for=me").catch(() => null), []);
  const range = setterRange(now);
  const calendar = useLoad(() => api<{ appointments: CalendarAppointment[] }>(`/api/app/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`), [range.from, range.to]);
  const week = score.data ? setterWeek(score.data.rows, goal.data) : null;
  const lines = week ? setterLines(week) : null;
  const appointments = setterAppointments(calendar.data?.appointments ?? [], me?.user.id, now);
  const actions: HeaderAction[] = [{ icon: "search", label: "Search", onPress: () => router.push("/search") }];
  const sub = week ? `Week ${week.week} · ${week.target ? `target ${week.target} appointments` : "no weekly target set"}` : longDate();
  const figure = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const tiles: [string, string, string?][] = [
    ["Dials", figure(week?.today.dials)],
    ["Contacts", figure(week?.today.contacts)],
    ["Appointments set", figure(week?.today.booked)],
    ["Show rate", week && week.showRatePct !== null ? `${week.showRatePct}%` : "–", "last 30 days"],
  ];

  return (
    <Screen title="Today" sub={sub} actions={actions} onRefresh={() => { score.refresh(); goal.reload(); calendar.reload(); }} refreshing={score.refreshing}>
      <HomePaused />
      <View style={{ paddingHorizontal: 16 }}>
        {/* The ring card always draws (board B3): an empty placeholder ring while the scorecard loads, and the
            same ring with what failed and Try again when it does not answer. */}
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Ring pct={week?.target ? (week.booked / week.target) * 100 : 0} size={84} label={week ? (week.target ? `${week.booked}/${week.target}` : String(week.booked)) : "–"} gold />
          <View style={{ flex: 1, minWidth: 0 }}>
            {week && lines ? (
              <>
                <T kind="ink" style={{ fontFamily: F.s, fontSize: 17, lineHeight: 22 }}>{lines.title}</T>
                <T kind="small" style={{ fontSize: 14, lineHeight: 19 }}>{lines.body}</T>
              </>
            ) : score.error && !score.loading ? (
              <>
                <T kind="ink" style={{ fontFamily: F.s, fontSize: 17, lineHeight: 22 }}>We couldn’t load your week</T>
                <TextLink label="Try again" onPress={score.reload} center={false} />
              </>
            ) : (
              <T kind="small" style={{ fontSize: 14, lineHeight: 19 }}>Loading your week…</T>
            )}
          </View>
        </Card>
      </View>
      <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
        <Button testID="home-serve-next" kind="gold" label="Serve next lead" icon="phoneOut" onPress={() => go("/calls?part=dialer")} />
      </View>
      <SectionHead>Today</SectionHead>
      <TileGrid>
        {tiles.map(([label, value, detail]) => <Half key={label}><Tile label={label} value={value} detail={detail} /></Half>)}
      </TileGrid>
      <SectionHead link="All" onLink={() => router.push("/calendar")}>Appointments you set</SectionHead>
      {calendar.loading && !calendar.data ? <Loading rows={3} /> : calendar.error && !calendar.data ? <Failed message={calendar.error} onRetry={calendar.reload} what="your appointments" /> : (
        <GroupBox>
          {appointments.length ? appointments.map((a, i) => (
            <Row key={a.id} testID={`home-appointment-${a.id}`} first={i === 0} icon="calendar" iconTone={a.upcoming ? "info" : "brand"} title={displayName(a.title)} meta={a.meta}
              chip={<Chip tone={a.chip.tone}>{a.chip.label}</Chip>}
              onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: a.id, at: a.startsAtUtc } } as never)} />
          )) : <Row first icon="calendar" iconTone="plain" title="No appointments set yet" meta="Ones you book from the dialer show here" />}
        </GroupBox>
      )}
    </Screen>
  );
}
