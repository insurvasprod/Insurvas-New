import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import type { Floor } from "@/components/inbound/types";
import { PickerSheet } from "@/components/leads/parts";
import { SegControl } from "@/components/leads/sheets";
import { Card, Chip, Empty, Failed, FilterChips, Header, Loading, Screen, SearchBox, type HeaderAction } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { periodOf, rankFigure, rankProducers, rankValue, seesMoney, teamPicks, type PeriodKey, type RankBy } from "./logic";
import { LeaderRow, openTeam } from "./parts";
import type { RosterAnswer, ScoresAnswer } from "./types";

const PERIODS: { key: PeriodKey; label: string }[] = [{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Year" }];

/**
 * Board I1 · Team, the owner's and the manager's tab (pushed as /team, `stacked`, for an owner whose bar has no
 * Team tab): producers ranked by what they make the agency, placement and
 * chargebacks beside it. Read from GET /api/app/agency/scorecards (the web's Producer scorecards, AG-1.9), whose
 * scope is the server's: everyone for the owner, an admin and the bookkeeper, a manager's own reports for a manager.
 * A manager sees the same list without money (owner rule): ranked by policies issued, chargebacks as a count.
 * A row opens the producer (I2). The metric is a dropdown chip; "All 18 ▾" picks a team (a manager and his reports,
 * from the agency's roster, GET /api/app/agency/producers; the chip opens no picker when there are no teams); "On the
 * phone now" narrows to whoever the inbound floor shows on a call now. That chip is always there: when the floor
 * cannot be read it carries no count and nobody is counted as on a call.
 */
export function TeamTab({ stacked }: { stacked?: boolean } = {}) {
  const { api, me } = useSession();
  const money = seesMoney(me);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [by, setBy] = useState<RankBy>(money ? "premium" : "issued");
  const [searching, setSearching] = useState(false);
  const [needle, setNeedle] = useState("");
  const [picking, setPicking] = useState(false);
  const [onPhone, setOnPhone] = useState(false);
  const [team, setTeam] = useState<string>("all");
  const [pickingTeam, setPickingTeam] = useState(false);
  const range = periodOf(period);
  const load = useLoad(() => api<ScoresAnswer>(`/api/app/agency/scorecards?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  // "On the phone" (board I1): who is on a call now, from the inbound floor (GET /api/app/agent-floor, every 15 s).
  // A person the floor does not cover (or a refusal) simply isn't counted; the chip stays, without a count.
  const floor = useLoad(() => api<Floor>("/api/app/agent-floor").catch(() => null), [], { every: 15_000 });
  const calling = new Set((floor.data?.members ?? []).filter((m) => m.availability === "on_call" || m.call).map((m) => m.id));
  for (const c of floor.data?.onCalls ?? []) calling.add(c.agentId);
  // Teams by manager, from the agency's roster; a workspace without one (or a refusal) has no teams to pick.
  const roster = useLoad(() => api<RosterAnswer>("/api/app/agency/producers").catch(() => null), []);
  const teams = teamPicks(roster.data?.rows ?? []);
  const picked = teams.find((t) => t.key === team) ?? null;

  const sorts: { key: RankBy; label: string }[] = [
    ...(money ? [{ key: "premium" as const, label: "Issued premium" }] : []),
    { key: "issued", label: "Policies issued" },
    { key: "placement", label: "Placement" },
    { key: "submitted", label: "Applications" },
  ];
  const sortLabel = sorts.find((s) => s.key === by)?.label ?? "Issued premium";
  const inTeam = (userId: string) => !picked || picked.members.has(userId);
  const everyone = (load.data?.rows ?? []).filter((r) => inTeam(r.producerUserId)).length;
  const chips = [
    { key: "metric", label: sortLabel, on: true, chevron: true, testID: "team-metric" },
    { key: "team", label: picked ? picked.label : "All", count: everyone || undefined, on: !onPhone, chevron: teams.length > 0, testID: "team-all" },
    { key: "phone", label: "On the phone now", count: floor.data ? calling.size : undefined, on: onPhone, testID: "team-on-phone" },
  ];
  const onChip = (k: string) => {
    if (k === "metric") setPicking(true);
    else if (k === "team") { if (onPhone) setOnPhone(false); else if (teams.length) setPickingTeam(true); }
    else setOnPhone(true);
  };
  const actions: HeaderAction[] = [{ icon: "search", label: "Search the team", onPress: () => { setSearching((s) => !s); setNeedle(""); } }];
  // Inviting a producer changes who is in the agency: the owner does it on the computer (the web's invite page).
  if (me?.role === "owner" && me.memberRole !== "manager") {
    actions.push({ icon: "userPlus", label: "Invite a producer", onPress: () => openTeam(`/computer?path=${encodeURIComponent("/app/producers/invite")}&title=${encodeURIComponent("Invite a producer")}`) });
  }
  const header = (
    <Header title="Team" large actions={actions} back={stacked ? "Home" : undefined} onBack={stacked ? () => router.back() : undefined}
      below={searching ? <SearchBox testID="team-search" value={needle} onChangeText={setNeedle} placeholder="Find a producer" autoFocus /> : undefined}
      belowFull={(
        <View style={{ paddingBottom: 10, gap: 10 }}>
          <View style={{ paddingHorizontal: 16 }}><SegControl items={PERIODS} value={period} onChange={(k) => setPeriod(k as PeriodKey)} /></View>
          <FilterChips items={chips} value={null} onChange={onChip} />
        </View>
      )} />
  );

  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={7} /> : <Failed what="the team" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.available) {
    body = <Empty icon="users" title="No carrier files yet" body="The team's figures are built from the agency's carrier policy files." />;
  } else {
    const rows = rankProducers(load.data.rows, by, needle).filter((r) => inTeam(r.producerUserId) && (!onPhone || calling.has(r.producerUserId)));
    const top = Math.max(...rows.map((r) => rankValue(r, by)), 0);
    body = !rows.length ? (
      onPhone && !needle
        ? <Empty icon="phone" title="No one is on a call" body={floor.data ? "Producers show here while they are on a transfer." : "Who is on a call can’t be read right now."} />
        : <Empty icon="users" title={needle ? "No one matches" : "No producers yet"} body={needle ? `No producer matches “${needle.trim()}”.` : "Producers appear here once they are active."} />
    ) : (
      <Card pad={false} style={{ marginHorizontal: 16, paddingVertical: 4 }}>
        {rows.map((r, i) => {
          const chargebacks = r.chargebacks ?? 0;
          return (
            <LeaderRow key={r.producerUserId} rank={i + 1} name={displayName(r.name)} figure={rankFigure(r, by)}
              meta={r.placement === "—" ? "Nothing issued yet" : `${r.placement} placed`}
              chip={chargebacks ? <Chip tone="warn">{chargebacks === 1 ? "1 chargeback" : `${chargebacks} chargebacks`}</Chip> : null}
              pct={top > 0 ? (100 * Math.max(0, rankValue(r, by))) / top : 0}
              onPress={() => openTeam(`/team/${r.producerUserId}`)} />
          );
        })}
      </Card>
    );
  }
  return (
    <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>
      {body}
      <PickerSheet title="Rank by" visible={picking} onClose={() => setPicking(false)} value={by}
        onPick={(k) => { setBy(k as RankBy); setPicking(false); }} items={sorts.map((s) => ({ key: s.key, label: s.label, icon: "chart" as const }))} />
      <PickerSheet title="Team" visible={pickingTeam} onClose={() => setPickingTeam(false)} value={team}
        onPick={(k) => { setTeam(k); setPickingTeam(false); }}
        items={[{ key: "all", label: "Everyone", icon: "users" as const }, ...teams.map((t) => ({ key: t.key, label: t.label, meta: `${t.members.size}`, icon: "users" as const }))]} />
    </Screen>
  );
}
