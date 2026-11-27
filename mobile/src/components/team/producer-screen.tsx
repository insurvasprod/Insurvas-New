import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { router } from "expo-router";

import { Ring } from "@/components/home/parts";
import { ActionSheet, Toast } from "@/components/leads/sheets";
import { Avatar, Card, Chip, Empty, F, Failed, Group, Header, Loading, Row, Screen, Tile, type HeaderAction } from "@/components/ui";
import { displayName } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { agencyPlacement, appointmentLines, change, comparisonName, dayMonth, expiringStates, goalPassedOn, initials, monthYear, periodOf, previousPeriod, renewalChip, renewsText, seesMoney, stateName, wholeMoney } from "./logic";
import { ChangeLine, RecordTitle, TileGrid, openTeam } from "./parts";
import type { GoalAnswer, ProducerCarriers, ProducerRecord, RosterAnswer, ScoresAnswer, TeamAnswer } from "./types";

/**
 * Board I2 · one producer: the month against their goal (the ring turns gold at 100%), what they wrote and what came
 * back, licences about to lapse and their appointments, and a way to reach them.
 *
 *   GET /api/app/agency/scorecards (this month and last)   applications, issued, placement, chargebacks
 *   GET /api/app/agency/producers → /[id] and /[id]/carriers  the record (role, manager, since) and appointments
 *   GET /api/app/goals?kind=premium&for=user                the producer's own premium goal (owner and admins only)
 *   GET /api/app/team                                       the states he is licensed in and when each lapses (owner only)
 *
 * A manager sees the same page in counts: no premium, no goal ring, chargebacks as a count. Talk time is not drawn:
 * no route records it (no phone provider yet), so the third tile is the month's issued policies.
 *
 * The owner always sees the goal ring: against the goal when one is set, with the day the running total of issued
 * premium passed it (GET /api/app/agency/scorecards?issued_days=1), else empty with "No goal set". The message
 * button opens (or starts) a direct chat with him — POST /api/app/partner-chat create_channel, the web chat's own
 * "new message" — and falls back to email when the chat is not on this plan; ⋯ holds email and the computer record.
 */
export function ProducerScreen({ userId }: { userId: string }) {
  const p = usePalette();
  const { api, me } = useSession();
  const money = seesMoney(me);
  const owner = me?.role === "owner" && me.memberRole !== "manager";
  const month = periodOf("month");
  const before = previousPeriod("month");
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useLoad(async () => {
    const [now, last, roster] = await Promise.all([
      api<ScoresAnswer>(`/api/app/agency/scorecards?from=${month.from}&to=${month.to}${money && owner ? "&issued_days=1" : ""}`),
      api<ScoresAnswer>(`/api/app/agency/scorecards?from=${before.from}&to=${before.to}`).catch(() => null),
      api<RosterAnswer>("/api/app/agency/producers").catch(() => null),
    ]);
    const producerId = roster?.rows.find((r) => r.userId === userId)?.id ?? null;
    const [record, carriers, goal, team] = await Promise.all([
      producerId ? api<ProducerRecord>(`/api/app/agency/producers/${producerId}`).catch(() => null) : null,
      producerId ? api<ProducerCarriers>(`/api/app/agency/producers/${producerId}/carriers`).catch(() => null) : null,
      money && owner ? api<GoalAnswer>(`/api/app/goals?kind=premium&for=user&user=${userId}`).catch(() => null) : null,
      owner ? api<TeamAnswer>("/api/app/team").catch(() => null) : null,
    ]);
    return { now, last, record, carriers, goal, team };
  }, [userId, month.from]);

  const d = load.data;
  const row = d?.now.rows.find((r) => r.producerUserId === userId) ?? null;
  const name = displayName(d?.record?.displayName ?? row?.name ?? "");
  const email = d?.record?.email ?? null;
  const mail = () => { if (email) void Linking.openURL(`mailto:${email}`).catch(() => undefined); };
  const message = async () => {
    try {
      const answer = await api<{ channel?: { id: string } }>("/api/app/partner-chat", { method: "POST", body: { action: "create_channel", channel_type: "direct", user_ids: [userId] } });
      if (answer.channel?.id) { openTeam(`/chat/${answer.channel.id}`); return; }
      throw new Error("no channel");
    } catch {
      if (email) mail();
      else setToast("Chat isn’t available here. Reach them on the computer.");
    }
  };
  const actions: HeaderAction[] = row && d?.record?.isSelf !== true ? [{ icon: "msg", label: `Message ${name || "them"}`, onPress: () => void message() }] : [];
  if (d?.record) actions.push({ icon: "moreH", label: "More", onPress: () => setMore(true) });
  const header = <Header back="Team" onBack={() => router.back()} large={false} actions={actions} />;

  let body;
  if (!d) {
    body = load.loading ? <Loading rows={5} /> : <Failed what="this producer" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!row) {
    body = <Empty icon="user" title="Not on your team" body="This producer isn’t in the team you can see, or has no scorecard yet." />;
  } else {
    const last = d.last?.rows.find((r) => r.producerUserId === userId) ?? null;
    const role = d.record?.role ? ROLE_LABELS[d.record.role] ?? d.record.role : "Producer";
    const sub = [role, d.record?.managerName ? `reports to ${d.record.managerName}` : null, d.record?.hiredOn ? `since ${monthYear(d.record.hiredOn)}` : null].filter(Boolean).join(" · ");
    const target = d.goal?.goal.state === "set" ? d.goal.goal.target : null;
    const issued = row.issuedAnnualCents ?? 0;
    const pct = target ? Math.round((100 * issued) / target) : 0;
    const passed = pct >= 100 ? goalPassedOn(d.now.issuedDays?.[userId], target) : null;
    const apps = change(row.submitted, last?.submitted ?? 0);
    const chargebacks = row.chargebacks ?? 0;
    const member = d.team?.members.find((m) => m.id === userId);
    const lapsing = expiringStates(member?.licensedStateExpiries);
    const appointments = appointmentLines((d.carriers?.rows ?? []).map((c) => ({ carrierName: c.carrierName, appointments: c.appointments })));
    body = (
      <View style={{ gap: 12 }}>
        <RecordTitle title={name} sub={sub} lead={<Avatar initials={initials(name)} size={64} />} />
        {money && owner ? (
          <Card style={{ marginHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Ring pct={target ? pct : 0} size={84} label={target ? `${pct}%` : "—"} gold={pct >= 100} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.s, fontSize: 17, color: p.ink }}>{!target ? "No goal set this month" : pct >= 100 ? (passed ? `Goal passed on ${dayMonth(passed)}` : "Goal passed this month") : `${pct}% of the month’s goal`}</Text>
              <Text style={{ fontFamily: F.r, fontSize: 14, color: p.muted }}>{target ? `${wholeMoney(issued)} of ${wholeMoney(target)} issued annual premium` : `${wholeMoney(issued)} issued annual premium · goals are set on the computer`}</Text>
            </View>
          </Card>
        ) : null}
        <TileGrid>
          <Tile label="Applications" value={String(row.submitted)} detail={<ChangeLine arrow={apps.arrow} value={apps.text} against={comparisonName("month")} />} />
          <Tile label="Placement" value={row.placement} detail={`Agency ${agencyPlacement(d.now.rows, d.now.minSample)}`} />
          <Tile label="Issued" value={String(row.issued)} detail={`Month 4 kept: ${row.m4.text}`} />
          <Tile label="Chargebacks" value={money ? wholeMoney(Math.abs(row.chargebackCents)) : String(chargebacks)} detail={chargebacks ? `${chargebacks} ${chargebacks === 1 ? "policy" : "policies"} in their book` : "None in their book"} />
        </TileGrid>
        {lapsing.length || appointments.length ? (
          <Group title="Licences and appointments">
            {lapsing.map((l, i) => <Row key={`l${l.state}`} first={i === 0} icon="badge" title={`${stateName(l.state)} licence`} meta={renewsText(l.on).replace(/^./, (c) => c.toUpperCase())} chip={<Chip tone={renewalChip(l.on).tone}>{renewalChip(l.on).text}</Chip>} />)}
            {appointments.slice(0, 6).map((a, i) => <Row key={a.key} first={!lapsing.length && i === 0} icon="badge" title={a.title} meta={a.meta} chip={<Chip tone={a.chip.tone}>{a.chip.text}</Chip>} />)}
          </Group>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      <ActionSheet visible={more} title={name || "Producer"} onClose={() => setMore(false)} actions={[
        ...(email ? [{ key: "mail", label: `Email ${name || "them"}`, icon: "mail" as const, onPress: mail }] : []),
        ...(d?.record ? [{ key: "computer", label: "Open the record on the computer", icon: "laptop" as const, onPress: () => openTeam(`/computer?path=${encodeURIComponent(`/app/producers/${d.record!.id}`)}&title=${encodeURIComponent(name || "Producer")}`) }] : []),
      ]} />
      <Toast text={toast} onHide={() => setToast(null)} />
    </View>
  );
}
