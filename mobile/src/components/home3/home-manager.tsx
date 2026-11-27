import { useState } from "react";
import { router } from "expo-router";

import { GroupBox } from "@/components/home/parts";
import { Chip, Failed, Loading, Row, Screen, SectionHead, Tile } from "@/components/ui";
import { compactCount } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { appsToday, clockSpan, dayKey, floorCounts, initials } from "./logic";
import { managerRows } from "./manager-floor";
import { Delta, Half, HomePaused, TileGrid } from "./parts";
import type { ApplicationsAnswer, FloorAnswer } from "./types";

/**
 * Board B8 · Home for a manager: people, not money. Who is on the phone now, what is waiting, today's applications
 * and the callbacks that slipped, all in counts. A manager's reads are scoped to his reports by the server.
 *
 *   GET /api/app/agent-floor     the floor: each person's status and call, waiting transfers, due callbacks (every 20 s)
 *   GET /api/app/applications    applications submitted today against the same day last week
 *
 * Nothing here is an amount. Rows run on a call → away → ready (manager-floor.ts). Left out, no data: "Wrapping up ·
 * outcome screen" — an active call stays open until its outcome is saved, so the floor cannot tell the outcome step
 * from the call (see manager-floor.ts).
 */
export function HomeManager() {
  const { me, api } = useSession();
  const { go } = useNav();
  const [today] = useState(() => dayKey(Date.now()));
  const floor = useLoad(() => api<FloorAnswer>("/api/app/agent-floor"), [], { every: 20_000 });
  const apps = useLoad(() => api<ApplicationsAnswer>("/api/app/applications").catch(() => null), []);
  const refresh = () => { floor.refresh(); apps.reload(); };

  const self = me?.user.id;
  // Durations count from the floor's own clock, so a row never drifts from the answer it was drawn from.
  const now = floor.data ? Date.parse(floor.data.generatedAt) : 0;
  const counts = floor.data ? floorCounts(floor.data.members, self) : null;
  const rows = floor.data ? managerRows(floor.data.members, self, now) : [];
  const waiting = floor.data?.waiting ?? [];
  const longest = waiting.length ? Math.max(...waiting.map((w) => (now - Date.parse(w.queuedAt)) / 1000)) : null;
  const late = (floor.data?.callbacks ?? []).filter((cb) => cb.isOverdue || cb.status === "missed");
  const latePeople = new Set(late.map((cb) => cb.assignedTo ?? "")).size;
  const written = apps.data ? appsToday(apps.data.applications, today) : null;
  const rise = written ? written.today - written.lastWeek : 0;

  let body;
  if (!floor.data) body = floor.loading ? <Loading rows={5} /> : <Failed what="the floor" message={floor.error ?? "Try again."} onRetry={floor.reload} />;
  else body = (
    <>
      <TileGrid>
        <Half><Tile testID="floor-on-call" label="On a call now" value={compactCount(counts?.onCall ?? 0)} detail={`of ${counts?.taking ?? 0} taking calls`} onPress={() => go("/teamtab")} /></Half>
        <Half><Tile testID="floor-waiting" label="Transfers waiting" value={compactCount(waiting.length)} detail={longest !== null ? `Longest ${clockSpan(longest)}` : "Nobody waiting"} onPress={() => go("/calls?part=incoming")} /></Half>
        {/* Always drawn: a read that failed or has not answered shows "—", so the four tiles keep their grid. */}
        <Half><Tile testID="floor-apps" label="Applications today" value={written ? compactCount(written.today) : "—"}
          detail={written ? (rise ? <Delta strong={`${rise > 0 ? "↑" : "↓"} ${Math.abs(rise)}`} rest={`vs last ${written.weekday}`} good={rise > 0} /> : `Same as last ${written.weekday}`) : apps.loading ? undefined : "Not available"}
          onPress={() => router.push("/application" as never)} /></Half>
        <Half><Tile testID="floor-callbacks" label="Callbacks overdue" value={compactCount(late.length)} detail={late.length ? <Chip tone="warn">{`${latePeople} ${latePeople === 1 ? "person" : "people"}`}</Chip> : "None"} onPress={() => go("/calls?part=callbacks")} /></Half>
      </TileGrid>

      <SectionHead link="Team activity" onLink={() => router.push("/reports/activity" as never)}>Right now</SectionHead>
      <GroupBox>
        {rows.length ? rows.map((r, i) => (
          <Row key={r.id} first={i === 0} testID={`floor-${r.id}`} avatar={initials(r.name)} title={r.name} meta={r.meta} chip={<Chip tone={r.chip.tone}>{r.chip.label}</Chip>} onPress={() => router.push(`/team/${r.id}` as never)} />
        )) : <Row first icon="users" iconTone="plain" title="Nobody reports to you yet" meta="The owner sets who reports to whom" />}
      </GroupBox>
    </>
  );

  return (
    <Screen title="Floor" sub={counts ? `Your team · ${counts.people} ${counts.people === 1 ? "producer" : "producers"}` : "Your team"} actions={[{ icon: "search", label: "Search", onPress: () => router.push("/search") }]} onRefresh={refresh} refreshing={floor.refreshing}>
      <HomePaused />
      {body}
    </Screen>
  );
}
