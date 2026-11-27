import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { dealRows, dollars, recentDays, seesPremium, unsignedLeads, versusLastWeek, type ApplicationsAnswer, type DealAnswer } from "@/components/cases/model";
import { addDays, dayKey, dayLabel, deviceZone } from "@/components/calls/time";
import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { Chip, Empty, F, Failed, Group, Header, Loading, Row, Screen, Tile } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board E7 · Daily deal flow: the day's deals across the team. The header counts every deal worked; the
 * list is "Written today", the deals written, newest first. Owners and producers see premium (the web's
 * deal-flow page lets only them in); the figure strip carries no colour (the rise is bold, not
 * coloured), and the one problem a row or the Deals tile names is a written deal whose application
 * still waits on a signature ("Unsigned", "3 need a signature"), from the Applications list. The
 * calendar button picks one of the last seven days. Data: GET /api/app/deal-flow?from=&to= for the day
 * and the same weekday a week before, and GET /api/app/applications.
 */
const PAGE = 500;

export default function DealFlow() {
  const p = usePalette();
  const { api, me } = useSession();
  const zone = deviceZone();
  const today = dayKey(new Date(), zone);
  const [day, setDay] = useState(today);
  const [picking, setPicking] = useState(false);
  const money = seesPremium(me?.role);
  const load = useLoad(async () => {
    const week = addDays(day, -7);
    const [now, before, apps] = await Promise.all([
      api<DealAnswer>(`/api/app/deal-flow?from=${day}&to=${day}&page_size=${PAGE}`),
      // Only the figure needs last week; a failure there leaves the comparison out, not the page.
      money ? api<DealAnswer>(`/api/app/deal-flow?from=${week}&to=${week}&page_size=1`).catch(() => null) : Promise.resolve(null),
      // The signature state; without the Applications feature the rows simply carry no chip.
      api<ApplicationsAnswer>("/api/app/applications").catch(() => null),
    ]);
    return { now, before, unsigned: unsignedLeads(apps?.applications ?? []) };
  }, [day, money]);

  const isToday = day === today;
  const data = load.data?.now;
  const k = data?.kpis;
  const sub = k ? `${isToday ? "Today" : dayLabel(day)} · ${k.deals_worked === 1 ? "1 deal" : `${k.deals_worked} deals`}` : undefined;
  const header = <Header title="Deal flow" sub={sub} back="Menu" onBack={() => router.back()} large actions={[{ icon: "calendar", label: "Pick a day", onPress: () => setPicking(true) }]} />;

  let body;
  if (!data && load.loading) body = <Loading rows={5} />;
  else if (!data || !k) body = <Failed what="the deal flow" message={load.error ?? "Something went wrong."} onRetry={load.reload} />;
  else {
    const rows = dealRows(data.rows, zone, money, load.data?.unsigned);
    const unsigned = rows.filter((r) => r.chip).length;
    const before = load.data?.before?.kpis;
    const vs = money && before ? versusLastWeek(k.won_annualised_cents, before.won_annualised_cents, day) : null;
    body = (
      <>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 2 }}>
          <View style={{ flex: 1 }}>
            {money ? (
              <Tile testID="deal-premium" label="Annual premium" value={dollars(k.won_annualised_cents)}
                detail={vs ? (
                  <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>
                    {vs.up != null ? <Text style={{ fontFamily: F.b, color: p.ink }}>{`${vs.up ? "↑" : "↓"} ${vs.amount}`}</Text> : null}
                    {vs.up != null ? " " : ""}{vs.label}
                  </Text>
                ) : k.won_unpriced ? `${k.won_unpriced} unpriced` : undefined} />
            ) : <Tile testID="deal-won" label="Written" value={String(k.won)} detail={k.won_unpriced ? `${k.won_unpriced} unpriced` : undefined} />}
          </View>
          <View style={{ flex: 1 }}>
            <Tile testID="deal-count" label="Deals" value={String(k.deals_worked)}
              detail={unsigned ? `${unsigned} need${unsigned === 1 ? "s" : ""} a signature` : `${k.won} written · ${k.in_progress} open`} />
          </View>
        </View>
        {rows.length ? (
          <Group title={isToday ? "Written today" : `Written ${dayLabel(day)}`} footer={data.total > data.rows.length ? `Showing the first ${data.rows.length} of ${data.total} deals. The rest are on the computer.` : undefined}>
            {rows.map((r, i) => (
              <Row key={r.id} testID={`deal-${r.id}`} first={i === 0} avatar={r.avatar} title={r.title} meta={r.meta} right={r.right ?? undefined}
                chip={r.chip ? <Chip tone="warn">{r.chip}</Chip> : undefined} onPress={() => router.push(`/lead/${r.leadId}` as never)} />
            ))}
          </Group>
        ) : <Empty icon="handshake" title={isToday ? "Nothing written yet today" : "Nothing written that day"} body={k.deals_worked ? `${k.deals_worked} worked, none written yet.` : "Deals land here as they are written."} />}
      </>
    );
  }

  return (
    <>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      <ChoiceSheet visible={picking} title="Show the deals of" options={recentDays(today)} selected={[day]} onPick={setDay} onClose={() => setPicking(false)} />
    </>
  );
}
