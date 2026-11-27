import { useState } from "react";
import { router } from "expo-router";

import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { localDay, waitingChip, waitingGroups, waitingMeta } from "./logic";
import { openRetention } from "./nav";
import type { WaitingAnswer, WaitingRequest } from "./types";

/**
 * Board F3b · Waiting on the carrier (GET /api/app/retention/servicing?list=waiting): the changes sent to a
 * carrier, each open until the next carrier file proves it and then closed by itself, and the ones a file proved
 * this week. A row opens the case it came from; a request opened without a case has no phone page.
 */
export function WaitingScreen() {
  const { api } = useSession();
  const load = useLoad(() => api<WaitingAnswer>("/api/app/retention/servicing?list=waiting"), []);
  // One clock for the whole list, read once, so every row counts its days from the same moment.
  const [now] = useState(() => Date.now());
  const today = localDay(new Date(now));
  const header = <Header title="Waiting on the carrier" back={IOS ? "Cases" : undefined} onBack={() => router.back()} large />;

  let body;
  if (!load.data) body = load.loading ? <Loading /> : <Failed what="the requests" message={load.error ?? "Try again."} onRetry={load.reload} />;
  else if (!load.data.available) body = <Empty icon="wrench" title="Not switched on yet" body={load.data.message} />;
  else {
    const { open, proven } = waitingGroups(load.data.requests, today, now);
    body = !open.length && !proven.length
      ? <Empty icon="wrench" title="Nothing waiting on a carrier" body="A change sent to a carrier waits here until the next carrier file shows it." />
      : (
        <>
          {open.length ? <Group title={`Not in a file yet · ${open.length}`}>{open.map((r, i) => <WaitingRow key={r.id} r={r} first={i === 0} today={today} now={now} />)}</Group> : null}
          {proven.length ? <Group title={`Proved by a file this week · ${proven.length}`}>{proven.map((r, i) => <WaitingRow key={r.id} r={r} first={i === 0} today={today} now={now} />)}</Group> : null}
        </>
      );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

export function WaitingRow({ r, first, today, now, chipText, meta }: { r: WaitingRequest; first?: boolean; today: string; now: number; chipText?: string; meta?: string }) {
  const chip = waitingChip(r, today, now);
  const proven = r.status === "verified_in_file";
  return (
    <Row first={first} icon={proven ? "checkC" : "wrench"} iconTone={proven ? "plain" : "brand"} title={displayName(r.clientName) ?? `Policy ${r.policyNumber}`} meta={meta ?? waitingMeta(r, now)}
      chip={<Chip tone={chip.tone}>{chipText ?? chip.text}</Chip>} onPress={r.caseId ? () => openRetention(`/retention/${r.caseId}`) : undefined} testID={`waiting-row-${r.id}`} />
  );
}
