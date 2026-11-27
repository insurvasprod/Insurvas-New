import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Button, Card, Chip, F, Failed, Header, IOS, Loading, Screen } from "@/components/ui";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { clock, dayWords, firstWord, leadChip, pipelineLabel, shortDay } from "./logic";
import { usePartnerSession } from "./session";
import type { PartnerChatAnswer, PartnerLeadDetail } from "./types";

/**
 * Board K3b · one lead the partner sent: where it is, the agency's coded outcome in the partner's words,
 * and its history, newest first. GET /api/partner/leads/[id] carries no internal note — only notes the
 * agency marked shared, and never the agency's composed disposition note (LA-1 audit). "Message the
 * agency" opens the partner's own conversation with the agency, the lead's name already written.
 *
 * With ?phone=1 the server adds the agency's dialer attempts as a count and a span, so the history groups
 * them as the board does ("Called 3 times · 20–21 Nov") — never each call's outcome. The agent who
 * accepted it is named by first name only.
 */
export type TimelineEvent = { key: string; title: string; when: string; at: string };

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** "20–21 Nov", "20 Nov", or "30 Nov – 2 Dec". */
export function daySpan(fromIso: string, toIso: string): string {
  const a = shortDay(localDay(fromIso));
  const b = shortDay(localDay(toIso));
  const [ad, am] = a.split(" ");
  const [bd, bm] = b.split(" ");
  if (a === b) return a;
  return am === bm ? `${ad}–${bd} ${bm}` : `${a} – ${b}`;
}
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The lead's history as the board lists it, newest first: what happened, then when (and who). */
export function leadEvents(detail: PartnerLeadDetail, now = new Date()): TimelineEvent[] {
  const when = (iso: string) => `${capital(dayWords(iso, now))} ${clock(iso)}`;
  const events: TimelineEvent[] = [];
  for (const [i, e] of detail.timeline.entries()) {
    // Chat messages about the lead live in the conversation, not in its history.
    if (e.type === "message") continue;
    if (e.type === "outcome") {
      // "Returned: wrong number · 21 Nov · agency": a closed stage names itself before the outcome.
      const title = detail.stageType === "lost" && !e.label.includes(":") && detail.stageName ? `${detail.stageName}: ${lower(e.label)}` : e.label;
      events.push({ key: `t${i}`, title, when: `${capital(dayWords(e.at, now))} · agency`, at: e.at });
      continue;
    }
    const title = e.type === "submitted" ? (e.detail ? `Sent by ${e.detail}` : "Sent")
      : e.type === "claimed" ? "Accepted"
      : e.type === "system" && e.detail ? e.detail
      : e.label;
    const who = e.type === "claimed" ? (detail.live?.claimedBy ?? (e.detail && e.detail !== "Agent" ? firstWord(e.detail) : null)) : null;
    events.push({ key: `t${i}`, title, when: who ? `${when(e.at)} · ${who}` : when(e.at), at: e.at });
  }
  for (const [i, n] of detail.notes.entries()) events.push({ key: `n${i}`, title: n.body, when: `${when(n.at)} · agency`, at: n.at });
  const tries = detail.attempts;
  if (tries && tries.count > 0) events.push({ key: "calls", title: tries.count === 1 ? "Called once" : `Called ${tries.count} times`, when: daySpan(tries.firstAt, tries.lastAt), at: tries.lastAt });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function PartnerLead({ id }: { id: string }) {
  const p = usePalette();
  const { api, me } = usePartnerSession();
  const lead = useLoad(() => api<PartnerLeadDetail>(`/api/partner/leads/${id}?phone=1`), [id]);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/partner/pipeline" as never));
  const header = <Header title={lead.data?.customer ?? ""} large={false} back={IOS ? pipelineLabel(me?.partnerType ?? "publisher") : undefined} onBack={back} />;

  if (lead.loading && !lead.data) return <Screen header={header}><Loading rows={4} /></Screen>;
  if (lead.error && !lead.data) return <Screen header={header}><Failed message={lead.error} onRetry={lead.refresh} what="this lead" /></Screen>;
  const d = lead.data!;
  const chip = leadChip(d);
  const events = leadEvents(d);

  const message = async () => {
    setOpening(true);
    setProblem(null);
    try {
      const chat = await api<PartnerChatAnswer>("/api/partner/chat");
      const own = chat.channels.find((c) => c.channel.channel_type === "partner") ?? chat.channels[0];
      if (!own) { setProblem("There’s no conversation with the agency yet."); return; }
      router.push({ pathname: "/partner/thread/[id]", params: { id: own.channel.id, draft: `About ${d.customer}: ` } } as never);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn’t open the conversation.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Screen header={header} onRefresh={lead.refresh} refreshing={lead.refreshing}>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`Sent ${dayWords(d.submittedAt)}`}</Text>
              <Text testID="lead-headline" style={{ fontFamily: F.s, fontSize: 18, color: p.ink }}>{d.outcome ? `${d.stageName} · ${d.outcome}` : d.stageName}</Text>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{d.product}</Text>
            </View>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </View>
        </Card>
        {events.length ? (
          <Card>
            {/* .timeline: a 2px rule 6px in, 12px rings (green for the newest), 15px titles, 13px times, 14px apart. */}
            <View style={{ paddingLeft: 22 }}>
              <View style={{ position: "absolute", left: 6, top: 6, bottom: 6, width: 2, backgroundColor: p.line2 }} />
              {events.map((e, i) => (
                <View key={e.key} testID={`event-${i}`} style={{ paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                  <View style={{ position: "absolute", left: -21, top: 5, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: i === 0 ? p.green : p.line2, backgroundColor: p.surf }} />
                  <Text style={{ fontFamily: F.m, fontSize: 15, color: p.ink }}>{e.title}</Text>
                  <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted }}>{e.when}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
        <Button testID="lead-message" kind="outline" icon="msg" write label={`Message the agency about ${firstWord(d.customer)}`} onPress={() => void message()} busy={opening} />
        {problem ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{problem}</Text> : null}
      </View>
    </Screen>
  );
}
