import { useEffect, useState } from "react";
import { reachable } from "@/lib/links";
import { currentTabs } from "@/lib/nav";
import { router } from "expo-router";

import { initials, teamGroups } from "@/components/inbound/model";
import type { Floor } from "@/components/inbound/types";
import { Chip, Empty, Failed, Group, Header, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Board C1c · Inbound team: who is taking calls right now and who is not, from the floor
 * (GET /api/app/agent-floor, the same scope as the web's Agent Floor). Anyone who takes transfers can
 * see it; nothing is changed here. Read every 10 seconds while open.
 *
 * Not drawn, because the server has no such fact (2026-11-26): the subtitle "Next transfer goes to …"
 * and the Next / 2nd chips (a waiting transfer goes to whoever claims it first; there is no rotation
 * order to read), and "Wrapping up · outcome screen" (the floor has no wrap-up state).
 */
export default function InboundTeam() {
  const { api, me } = useSession();
  const floor = useLoad(() => api<Floor>("/api/app/agent-floor"), [], { every: 10_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const header = <Header title="Inbound team" back="Calls" onBack={() => (router.canGoBack() ? router.back() : router.replace(reachable("/calls", currentTabs()) as never))} large />;
  if (!floor.data) {
    return <Screen header={header}>{floor.error ? (floor.errorCode?.status === 403 ? <Empty icon="lock" title="Transfers aren’t on for you" body={floor.error} /> : <Failed message={floor.error} onRetry={floor.reload} />) : <Loading rows={5} />}</Screen>;
  }

  const { taking, notTaking } = teamGroups(floor.data.members, me?.user.id, floor.data.onCalls ?? [], now);
  const rows = [...taking, ...notTaking];
  const names = new Map(floor.data.members.map((m) => [m.id, m.name]));

  return (
    <Screen header={header} onRefresh={floor.refresh} refreshing={floor.refreshing}>
      {taking.length ? (
        <Group title={`Taking calls · ${taking.length}`}>
          {taking.map((r, i) => <Row key={r.id} testID={`team-${r.id}`} first={i === 0} avatar={initials(names.get(r.id) ?? r.name)} title={r.name} meta={r.meta} chip={r.chip ? <Chip tone={r.chip.tone}>{r.chip.text}</Chip> : undefined} />)}
        </Group>
      ) : null}
      {notTaking.length ? (
        <Group title={`Not taking calls · ${notTaking.length}`}>
          {/* The "Away" chip: an on-call member the server stopped hearing from is listed here, chip and all. */}
          {notTaking.map((r, i) => <Row key={r.id} testID={`team-${r.id}`} first={i === 0} avatar={initials(names.get(r.id) ?? r.name)} title={r.name} meta={r.meta} chip={r.chip ? <Chip tone={r.chip.tone}>{r.chip.text}</Chip> : undefined} />)}
        </Group>
      ) : null}
      {!rows.length ? <Empty icon="users" title="Nobody on the floor yet" body="People who take transfers show here." /> : null}
    </Screen>
  );
}
