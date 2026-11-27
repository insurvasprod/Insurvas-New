import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { CallSheet } from "@/components/call-sheet";
import { GroupBox, Ring } from "@/components/home/parts";
import { HomePaused } from "@/components/home3/parts";
import { Toast } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Loading, Row, Screen, SectionHead, T } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { CallDialog } from "./case-screen";
import { callTodayRows, countdown, lastFileSub, ringCard, type MonthCounts } from "./home-logic";
import { LogAttemptSheet } from "./log-attempt-sheet";
import { openRetention } from "./nav";
import { CHANGE_LABEL, STEP_LABEL, bucketOf, callToday, caseName, dayMonth, localDay, waitingGroups } from "./logic";
import { WaitingRow } from "./waiting-screen";
import type { CaseAnswer, CaseDetail, CaseItem, CasesAnswer, WaitingAnswer } from "./types";

/** The list read plus the two facts board B7 adds (app/api/app/retention/cases): the last file's arrival and the agency's month. */
type HomeCasesAnswer = CasesAnswer & { lastFileAt?: string | null; team?: MonthCounts | null };

/**
 * Board B7 · Home for a retention rep: the day in counts of policies, never dollars. As drawn: the ring card
 * ("23 saved of 41 worked · November · team average 48%", the ring the save rate), the gold "Call the next case"
 * (the most urgent case, or the Cases list when nothing is due), "Call today" (cases past the carrier's date or lost
 * this week, "Pending lapse · Mutual of Omaha" with a warn countdown) and "Waiting on the carrier". Read from
 * GET /api/app/retention/cases and GET /api/app/retention/servicing?list=waiting; both answer the rep's own work.
 *
 * Not drawn, no data: the board's "Try again · 10:00 am his time" callback rows (a retention case has no next-attempt
 * time to read).
 *
 * "Call the next case" starts the call, as F4's Call does: it reads the case (GET /api/app/retention/cases?id=) for
 * the lead behind the policy, then opens the call sheet, which runs every server check (disclosure, DNC, calling
 * window, consent, the claim through POST /api/app/dialer/pick) before the phone's dialer opens — never a bare tel:.
 * With no lead, or a role with no dialer, it shows F4's call dialog (copy the number, Log attempt). A saved call opens
 * Log attempt (F5). Nothing due opens the Cases list. Board M6: the paused reason opens the Home.
 */
export function RetentionHome() {
  const { api } = useSession();
  const [calling, setCalling] = useState<CaseDetail | null>(null);
  const [logging, setLogging] = useState<CaseDetail | null>(null);
  const [reading, setReading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const cases = useLoad(() => api<HomeCasesAnswer>("/api/app/retention/cases"), []);
  // The servicing feature can be off for the agency; then this part simply isn't drawn.
  const waiting = useLoad(() => api<WaitingAnswer>("/api/app/retention/servicing?list=waiting").catch(() => null), []);
  const [now] = useState(() => Date.now());
  const today = localDay(new Date(now));
  const data = cases.data?.available ? cases.data : null;

  const refresh = () => { cases.refresh(); waiting.reload(); };
  // The list row has no lead or dial right; the case read names both. If it can't be read, open the case instead.
  const callNext = async (id: string) => {
    setReading(true);
    try {
      const answer = await api<CaseAnswer>(`/api/app/retention/cases?id=${encodeURIComponent(id)}`);
      setCalling(answer.case);
    } catch {
      openRetention(`/retention/${id}`);
    } finally {
      setReading(false);
    }
  };
  const sub = data ? lastFileSub(data.lastFileAt, data.lastFileDate, new Date(now)) : undefined;
  const open = waiting.data?.available ? waitingGroups(waiting.data.requests, today, now).open.slice(0, 3) : [];

  let body;
  if (!cases.data) body = cases.loading ? <Loading rows={4} /> : <Failed what="your cases" message={cases.error ?? "Try again."} onRetry={cases.reload} />;
  else if (!data) body = <Empty icon="buoy" title="Not switched on yet" body={cases.data.available ? undefined : cases.data.message} />;
  else {
    const ring = ringCard(data.month, data.today, data.team);
    const due = callToday(data.cases);
    const next = due[0] ?? null;
    const rows = callTodayRows(due);
    body = (
      <>
        <View style={{ paddingHorizontal: 16 }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Ring pct={ring.pct} size={80} label={ring.label} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T kind="ink" style={{ fontFamily: F.s, fontSize: 17, lineHeight: 22 }}>{ring.title}</T>
              <T kind="small" style={{ fontSize: 14, lineHeight: 19 }}>{ring.line}</T>
            </View>
          </Card>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <Button testID="home-next-case" kind="gold" label="Call the next case" icon="phoneOut" busy={reading} disabled={reading}
            onPress={() => (next ? void callNext(next.id) : openRetention("/retention"))} />
        </View>
        <SectionHead link="Cases" onLink={() => openRetention("/retention")}>Call today</SectionHead>
        <GroupBox>
          {rows.length ? rows.map((c, i) => <CallTodayRow key={c.id} c={c} first={i === 0} />)
            : <Row first icon="calCheck" iconTone="plain" title="Nothing due this week" meta={data.cases.length ? `${data.cases.length} open ${data.cases.length === 1 ? "case" : "cases"} on the ladder` : undefined} />}
        </GroupBox>
        {open.length ? (
          <>
            <SectionHead>Waiting on the carrier</SectionHead>
            <GroupBox>
              {open.map((r, i) => (
                <WaitingRow key={r.id} r={r} first={i === 0} today={today} now={now}
                  meta={r.submittedAt ? `${CHANGE_LABEL[r.type]} sent · ${dayMonth(r.submittedAt)}` : `${CHANGE_LABEL[r.type]} · not sent yet`}
                  chipText={bucketOf(r, today) === "waiting" ? "Not in a file yet" : undefined} />
              ))}
            </GroupBox>
          </>
        ) : null}
      </>
    );
  }

  const dials = Boolean(calling?.canDial && calling.leadId);
  return (
    <View style={{ flex: 1 }}>
      <Screen title="Today" sub={sub} actions={[{ icon: "search", label: "Search", onPress: () => router.push("/search") }]} onRefresh={refresh} refreshing={cases.refreshing}>
        <HomePaused />
        {body}
      </Screen>
      {calling && dials ? (
        <CallSheet leadId={calling.leadId!} visible backLabel="Today" onClose={() => setCalling(null)}
          onSaved={() => { setLogging(calling); setCalling(null); }} />
      ) : calling ? (
        <CallDialog c={calling} visible onClose={() => setCalling(null)} onLog={() => { setLogging(calling); setCalling(null); }} />
      ) : null}
      {logging ? (
        <LogAttemptSheet item={logging} visible onClose={() => setLogging(null)}
          onSaved={(message) => { setLogging(null); setToast(message); refresh(); }} />
      ) : null}
      <Toast text={toast} onHide={() => setToast(null)} />
    </View>
  );
}

/** A "Call today" row as drawn: the buoy in warn, "Pending lapse · Mutual of Omaha", the countdown in a warn chip. */
function CallTodayRow({ c, first }: { c: CaseItem; first: boolean }) {
  const left = countdown(c);
  return (
    <Row first={first} icon="buoy" iconTone="warn" title={caseName(c)} meta={`${STEP_LABEL[c.step]} · ${c.carrierName}`}
      chip={left ? <Chip tone="warn">{left}</Chip> : undefined} onPress={() => openRetention(`/retention/${c.id}`)} testID={`case-row-${c.id}`} />
  );
}
