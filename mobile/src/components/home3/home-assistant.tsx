import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { GroupBox } from "@/components/home/parts";
import { longDate } from "@/components/home/when";
import { Button, Chip, Failed, Loading, Row, Screen, SectionHead, Tile, type HeaderAction } from "@/components/ui";
import { callbackOpen } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { CallbacksAnswer } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

import { handOffTime, handoffLines, versusYesterday, type MyHandoffsAnswer } from "./assistant-handoffs";
import { CallbackRow } from "./callback-row";
import { Delta, Half, HomePaused, TileGrid } from "./parts";

/**
 * Board B5 · Home for an assistant, in the board's order: Take the next caller, "Your handoffs" (offered and
 * accepted, with Waiting / Accepted chips), the four "Today" tiles, then "Callbacks you help with".
 * Handoffs and today's figures are GET /api/app/inbound/handoff?mine=1; the subtitle's agent count is the same
 * route without `mine` (the licensed agents this assistant verifies for); callbacks GET /api/app/callbacks.
 */
export function HomeAssistant() {
  const { me, api } = useSession();
  const { go } = useNav();
  const [now] = useState(() => Date.now());
  const features = me?.plan?.features;
  const parts = callsPartsFor("assistant", features);
  const canCallbacks = parts.includes("callbacks");
  const takesCalls = parts.includes("incoming");
  const callbacks = useLoad(async () => (canCallbacks ? api<CallbacksAnswer>("/api/app/callbacks") : null), [canCallbacks]);
  const verifying = useLoad(() => (takesCalls ? api<{ licensedAgents: unknown[] }>("/api/app/inbound/handoff").catch(() => null) : Promise.resolve(null)), [takesCalls]);
  const mine = useLoad(async () => (takesCalls ? api<MyHandoffsAnswer>("/api/app/inbound/handoff?mine=1") : null), [takesCalls]);
  const agents = verifying.data?.licensedAgents.length;
  const viewer = callbacks.data?.viewer.userId;
  const today = (callbacks.data?.callbacks ?? [])
    .filter((cb) => (cb.isDueToday || cb.isOverdue) && callbackOpen(cb.status))
    .sort((a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc));
  const actions: HeaderAction[] = [{ icon: "search", label: "Search", onPress: () => router.push("/search") }];
  const sub = agents ? `Verifying for ${agents} licensed ${agents === 1 ? "agent" : "agents"}` : longDate();
  const t = mine.data?.today;
  const vs = t ? versusYesterday(t.handedOff, t.handedOffYesterday) : null;
  const lines = mine.data ? handoffLines(mine.data.handoffs, now) : [];

  return (
    <Screen title="Today" sub={sub} actions={actions} onRefresh={() => { mine.refresh(); void callbacks.reload(); verifying.reload(); }} refreshing={mine.refreshing}>
      <HomePaused />
      <View style={{ paddingHorizontal: 16 }}>
        <Button testID="home-take-next" kind="gold" label="Take the next caller" icon="phoneIn" onPress={() => go("/calls?part=incoming")} />
      </View>
      {takesCalls ? (
        <>
          <SectionHead>Your handoffs</SectionHead>
          {mine.loading && !mine.data ? <Loading rows={2} /> : mine.error && !mine.data ? <Failed message={mine.error} onRetry={mine.reload} what="your handoffs" /> : (
            <GroupBox>
              {lines.length ? lines.map((h, i) => (
                <Row key={h.id} testID={`home-handoff-${h.id}`} first={i === 0} icon={h.icon} iconTone={h.iconTone} title={h.title} meta={h.meta}
                  chip={<Chip tone={h.chip.tone}>{h.chip.label}</Chip>} onPress={h.leadId ? () => router.push(`/lead/${h.leadId}`) : undefined} />
              )) : <Row first icon="userPlus" iconTone="plain" title="No handoffs yet today" meta="Callers you hand to a licensed agent show here" />}
            </GroupBox>
          )}
          <SectionHead>Today</SectionHead>
          <TileGrid>
            <Half><Tile label="Calls verified" value={t ? String(t.verified) : "–"} /></Half>
            <Half><Tile label="Handed off" value={t ? String(t.handedOff) : "–"} detail={vs ? <Delta strong={vs.strong} rest={vs.rest} good={vs.good} /> : undefined} /></Half>
            <Half><Tile label="Avg to hand off" value={t ? handOffTime(t.avgSecondsToHandOff) : "–"} /></Half>
            <Half><Tile label="Accepted" value={t ? `${t.accepted} of ${t.handedOff}` : "–"} /></Half>
          </TileGrid>
        </>
      ) : null}
      {canCallbacks ? (
        <>
          <SectionHead link="All" onLink={() => go("/calls?part=callbacks")}>Callbacks you help with</SectionHead>
          {callbacks.loading && !callbacks.data ? <Loading rows={3} /> : callbacks.error && !callbacks.data ? <Failed message={callbacks.error} onRetry={callbacks.reload} /> : (
            <GroupBox>
              {today.length ? today.slice(0, 5).map((cb, i) => <CallbackRow key={cb.id} cb={cb} first={i === 0} viewer={viewer} forOthers />)
                : <Row first icon="calCheck" iconTone="plain" title="No callbacks due today" />}
            </GroupBox>
          )}
        </>
      ) : null}
    </Screen>
  );
}
