import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Ring } from "@/components/home/parts";
import { ActionSheet, Sheet, SheetField, Toast } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Group, Header, Loading, Row, Screen } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { channelLabel, complaintLog, complaintWho, countdownChip, countdownShare, dayMonth, historyLine, initials, splitComplaints, viaLabel, weekdayDate } from "./logic";
import { CardTitle, RecordTitle, openTeam } from "./parts";
import type { Complaint, ComplaintAnswer, ComplaintsAnswer } from "./types";

const CATEGORY: Record<string, string> = { unwanted_calls: "Unwanted calls", misrepresentation: "Misrepresentation", billing: "Billing", service: "Service", claim_handling: "Claim handling", agent_conduct: "Agent conduct", other: "Other" };

// ─── I6 · Complaints ──────────────────────────────────────────────────────────────────────────
/**
 * Board I6 · Complaints (GET /api/app/compliance/complaints, the web's LA-6.4 list; owner and producer, refused to a
 * narrowed agency session): every open complaint with its owner and countdown, soonest deadline first, then the
 * ones closed lately. A row opens the complaint (I6b). Opening a new one and the evidence packet are the computer's.
 */
export function ComplaintsScreen({ back = "Menu" }: { back?: string }) {
  const { api } = useSession();
  const load = useLoad(() => api<ComplaintsAnswer>("/api/app/compliance/complaints"), []);
  const split = load.data ? splitComplaints(load.data.complaints) : null;
  const year = String(new Date().getFullYear());
  const closedThisYear = split ? split.closed.filter((c) => (c.resolvedAt ?? "").startsWith(year)).length : 0;
  const header = <Header title="Complaints" back={back} onBack={() => router.back()} large sub={split ? `${split.open.length} open · ${closedThisYear} closed this year` : undefined} />;
  let body;
  if (!load.data || !split) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="the complaints" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.complaints.length) {
    body = <Empty icon="checkC" title="No complaints" body="A complaint is logged on the computer when one comes in." />;
  } else {
    body = (
      <View>
        <Group title="Open">
          {split.open.length ? split.open.map((c, i) => {
            const chip = countdownChip(c.countdown);
            return <Row key={c.id} first={i === 0} icon="alert" iconTone={chip.tone === "bad" || chip.tone === "warn" ? "warn" : "brand"} title={complaintWho(c)} meta={`${c.summary} · ${displayName(c.owner.name)}`}
              chip={<Chip tone={chip.tone}>{chip.text}</Chip>} onPress={() => openTeam(`/compliance/complaints/${c.id}`)} testID={`complaint-${c.id}`} />;
          }) : <Row first icon="checkC" title="Nothing open" />}
        </Group>
        {split.closed.length ? (
          <Group title="Closed lately">
            {split.closed.slice(0, 5).map((c, i) => (
              <Row key={c.id} first={i === 0} icon="checkC" iconTone="plain" title={complaintWho(c)} meta={`${c.summary} · ${c.resolvedAt ? `closed ${dayMonth(c.resolvedAt.slice(0, 10))}` : CATEGORY[c.category] ?? c.category}`}
                chip={<Chip tone="ok">Resolved</Chip>} onPress={() => openTeam(`/compliance/complaints/${c.id}`)} />
            ))}
          </Group>
        ) : null}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

// ─── I6b · Complaint ──────────────────────────────────────────────────────────────────────────
/**
 * Board I6b · one complaint (GET /api/app/compliance/complaints/[id]): the countdown, who owns it, what was said and
 * its log — who recorded it, each reassignment and reply and who made it, from the complaint's audit trail (`history`)
 * — under a sub-line naming the carrier of the policy (`carrierName`). Two moves work on the phone, both the web
 * record's own PATCH: Reassign (owner_user_id, to someone the record page offers) and Log a reply (the agent's own
 * words as response_text, stamped responded now, the status moved to Responded). ⋯ opens the record on the computer,
 * where the response checklist and the evidence packet are. Calls back to the complainant are not in the log: the
 * complaint does not link to the calls made to them.
 */
export function ComplaintScreen({ id }: { id: string }) {
  const p = usePalette();
  const { api } = useSession();
  const load = useLoad(() => api<ComplaintAnswer>(`/api/app/compliance/complaints/${id}`), [id]);
  const [picking, setPicking] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api<{ complaint: Complaint }>(`/api/app/compliance/complaints/${id}`, { method: "PATCH", body: patch });
      load.setData((d) => (d ? { ...d, complaint: answer.complaint } : d));
      setToast(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The complaint could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const c = load.data?.complaint;
  const header = <Header back="Complaints" onBack={() => router.back()} large={false}
    actions={c ? [{ icon: "moreH", label: "More", onPress: () => setMore(true) }] : []} />;

  let body;
  if (!c) {
    body = load.loading ? <Loading rows={4} /> : <Failed what="the complaint" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const closed = c.status === "resolved";
    const chip = countdownChip(c.countdown);
    const left = c.countdown.daysLeft;
    const policy = [load.data?.carrierName, c.policyNumber].filter(Boolean).join(" ");
    const sub = [viaLabel(c.receivedVia), `received ${dayMonth(c.receivedAt.slice(0, 10))}`, policy || null].filter(Boolean).join(" · ");
    const history = load.data?.history ?? [];
    body = (
      <View style={{ gap: 12 }}>
        <RecordTitle title={complaintWho(c)} sub={sub} />
        {c.responseDueAt && !closed ? (
          <Card style={{ marginHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Reply due</Text>
              <Text style={{ fontFamily: F.db, fontSize: 26, color: p.ink, fontVariant: ["tabular-nums"] }}>{weekdayDate(c.responseDueAt)}</Text>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`${c.countdown.label} · ${channelLabel(c)}`}</Text>
            </View>
            <Ring pct={countdownShare(c)} size={72} label={left === null ? "—" : left < 0 ? `${Math.abs(left)}d` : `${left}d`} bad={chip.tone === "bad"} />
          </Card>
        ) : (
          <Card style={{ marginHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: F.r, fontSize: 15, color: p.body }}>{closed ? `Resolved ${dayMonth(c.resolvedAt?.slice(0, 10))}` : `No deadline · ${channelLabel(c)}`}</Text>
            <Chip tone={closed ? "ok" : chip.tone}>{closed ? "Resolved" : chip.text}</Chip>
          </Card>
        )}
        <Card style={{ marginHorizontal: 16 }}>
          <CardTitle>What they said</CardTitle>
          <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{c.summary}</Text>
          <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{[CATEGORY[c.category] ?? c.category, c.aboutAgent ? `about ${displayName(c.aboutAgent.name)}` : null].filter(Boolean).join(" · ")}</Text>
        </Card>
        <Group title="Log">
          <Row first avatar={initials(c.owner.name)} title={`Owned by ${displayName(c.owner.name)}`} meta={c.notes ?? "Owner of the reply"} chevron={false} />
          {history.length
            ? history.map((e) => { const l = historyLine(e); return <Row key={l.key} icon={l.icon} title={l.title} meta={l.meta} chevron={false} />; })
            : complaintLog(c).map((e) => <Row key={e.key} icon={e.icon} title={e.title} meta={e.meta} chevron={false} />)}
        </Group>
      </View>
    );
  }

  const team = load.data?.team ?? [];
  const footer = c && c.status !== "resolved" ? (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Button kind="outline" icon="userPlus" label="Reassign" style={{ flex: 1 }} disabled={!team.length || busy} onPress={() => setPicking(true)} testID="complaint-reassign" />
      <Button icon="note" label="Log a reply" style={{ flex: 1 }} disabled={busy} onPress={() => { setReply(c.responseText ?? ""); setError(null); setReplying(true); }} testID="complaint-reply" />
    </View>
  ) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} footer={footer} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      <ActionSheet visible={picking} title="Give it to" onClose={() => setPicking(false)} actions={team.filter((m) => m.id !== c?.owner.id).map((m) => ({
        key: m.id, label: displayName(m.name), icon: "user" as const, onPress: () => void save({ owner_user_id: m.id }, `Given to ${displayName(m.name)}`),
      }))} />
      <Sheet visible={replying} title="Log a reply" onClose={() => setReplying(false)} testID="reply-sheet"
        footer={<Button write testID="reply-save" label="Save the reply" busy={busy} disabled={!reply.trim()} onPress={() => void save({ response_text: reply.trim(), responded_at: new Date().toISOString(), ...(c && ["open", "investigating"].includes(c.status) ? { status: "responded" } : {}) }, "Reply logged").then((ok) => { if (ok) setReplying(false); })} />}>
        <View style={{ gap: 10, paddingBottom: 8 }}>
          <Text style={{ fontFamily: F.r, fontSize: 14, color: p.muted }}>What you told them, in your own words. It is kept on the complaint as the reply.</Text>
          <SheetField label="The reply" value={reply} onChangeText={setReply} multiline error={error} testID="reply-text" />
        </View>
      </Sheet>
      <ActionSheet visible={more} title="Complaint" onClose={() => setMore(false)} actions={[
        { key: "computer", label: "Open on the computer", icon: "laptop", onPress: () => openTeam(`/computer?path=${encodeURIComponent(`/app/complaints/${id}`)}&title=${encodeURIComponent("Complaint")}`) },
      ]} />
      <Toast text={toast} onHide={() => setToast(null)} bottom={110} />
      {error && !replying ? <View style={{ position: "absolute", left: 16, right: 16, bottom: 120 }}><Text style={{ fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text></View> : null}
    </View>
  );
}

