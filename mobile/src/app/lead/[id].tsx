import { useMemo, useState, type ReactNode } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CallSheet } from "@/components/call-sheet";
import { clock, dayKey, dayLabel, deviceZone } from "@/components/calls/time";
import { Icon, type IconName } from "@/components/icon";
import { LeadMenu } from "@/components/leads/actions";
import { ApplicationEntry, ApplicationTab } from "@/components/leads/application";
import { ageFromDob, bornLine, dayMonth, eventTitle, eventWhen, moveTitle, pronoun, readableDetail, readinessLines, sourceKind, usdCents } from "@/components/leads/logic";
import { MoveSheet } from "@/components/leads/move-sheet";
import { CardTitle, Composer, KV, StagePath, Timeline, UnderTabs, type TimelineItem } from "@/components/leads/parts";
import { ScheduleSheet } from "@/components/leads/schedule";
import { Toast } from "@/components/leads/sheets";
import { ConversationTab, NurtureTab, VerificationTab } from "@/components/leads/tabs";
import type { FullWorkspace, NextAction, Screening } from "@/components/leads/types";
import { Avatar, Button, Card, Chip, Empty, F, Failed, Header, Loading } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { isQueued } from "@/lib/outbox";
import { useCounts } from "@/lib/counts";
import { codeLabel, firstName, leadFact, leadName, phoneLabel } from "@/lib/format";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { Note } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import type { Tone } from "@/theme/tokens";
import { usePalette } from "@/theme/use-palette";

/**
 * Board D3 · Lead page, with D4 · Activity, D3b · Conversation, D3c · Nurture, D3d · Verification and
 * Application (links into the application screens) as its six tabs, D5 · the ⋯ menu (always there)
 * and D6 · a tap on the stage path. The title, the screening chip, the stage path, the tabs, then the
 * person, what happens next (the server's four readiness answers: consent, coverage, beneficiary,
 * bank) with Start application, and where the lead came from (cost with cents). Schedule
 * (a callback, POST /api/app/callbacks) and Call (the call sheet's checked dial) sit in the bottom
 * bar; Activity and Conversation swap them for the note box. Everything shown is the server's
 * (GET /api/app/leads/:id with its lineage and next action, the notes, the record).
 */
type Workspace = FullWorkspace;
type TabKey = "details" | "activity" | "conversation" | "nurture" | "verification" | "application";
const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" }, { key: "activity", label: "Activity" }, { key: "conversation", label: "Conversation" },
  { key: "nurture", label: "Nurture" }, { key: "verification", label: "Verification" }, { key: "application", label: "Application" },
];
const MOVERS = ["owner", "producer", "assistant"];
/** The roles POST /api/app/callbacks books for (callback_calendar). */
const SCHEDULERS = ["owner", "producer", "assistant"];

const DOB_KEYS = ["date_of_birth", "dob", "birth_date", "birthdate"];

/** The screening chip beside the name, in the web's words (lead-detail-workspace.tsx); none until the number was screened. */
function screeningChip(s: Screening): { tone: Tone; text: string } | null {
  if (!s?.outcome) return null;
  if (s.outcome === "clear") return s.warning ? { tone: "warn", text: "Needs review" } : { tone: "ok", text: "Clear to call" };
  if (s.outcome === "unavailable") return { tone: "neutral", text: "Not screened" };
  return { tone: "bad", text: codeLabel(s.outcome) ?? s.outcome };
}

/** "Callback Thu 26 Nov, 10:00 am their time" or "Next dial Thu 26 Nov, 9:00 am". */
function nextLine(next: NextAction): string | null {
  if (!next) return null;
  const at = new Date(next.at);
  if (Number.isNaN(at.getTime())) return null;
  if (next.kind === "callback") return `Callback ${dayLabel(dayKey(at, next.timezone))}, ${clock(at, next.timezone)} their time`;
  const zone = deviceZone();
  return `Next dial ${dayLabel(dayKey(at, zone))}, ${clock(at, zone)}`;
}

export default function LeadPage() {
  const { id, served } = useLocalSearchParams<{ id: string; served?: string }>();
  return <LeadRecord id={id} served={served} />;
}

/**
 * The lead page's body. The route draws it full screen; a tablet's right pane (board L6,
 * components/native) draws it beside the list with `onClose`: no stack header and no back, a Close
 * button instead, since the list is still on screen.
 */
export function LeadRecord({ id, served, onClose }: { id: string; served?: string; onClose?: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const embedded = Boolean(onClose);
  const { me, api } = useSession();
  const counts = useCounts();
  const [calling, setCalling] = useState(Boolean(served));
  const [scheduling, setScheduling] = useState(false);
  const [tab, setTab] = useState<TabKey>("details");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [moveTo, setMoveTo] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** When the page opened: events older than a day are drawn muted on the timeline. */
  const [openedAt] = useState(() => Date.now());
  const lead = useLoad(() => api<Workspace>(`/api/app/leads/${id}`), [id]);
  const notes = useLoad(() => api<{ notes: Note[] }>(`/api/app/leads/${id}/notes`), [id]);
  const canDial = callsPartsFor(me?.role, me?.plan?.features).includes("dialer") && me?.role !== "assistant";

  async function addNote() {
    const body = note.trim();
    if (!body) return;
    setSaving(true);
    // On Conversation a note goes to the partner's channel when the lead has a partner (LA-1.21).
    const visibility = tab === "conversation" && lead.data?.partner ? "shared" : "internal";
    try {
      const answer = await api<unknown>(`/api/app/leads/${id}/notes`, { method: "POST", body: { body, visibility, idempotency_key: `app-${id}-${Date.now()}` } });
      setNote("");
      // Board L4: no signal, so the note waits on the phone (lib/outbox.ts); it isn't on the lead yet.
      if (isQueued(answer)) { setToast("Saved on this phone · sends when you’re back online"); return; }
      void notes.reload();
      void lead.reload();
    } catch (e) {
      Alert.alert("Note not saved", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const w = lead.data;
  const values = useMemo(() => w?.lead.values ?? {}, [w]);
  const they = pronoun(values);
  const name = w ? leadName(values) : "";
  const rawPhone = leadFact(values, "phone", "phone_number", "mobile_phone");
  const phone = phoneLabel(rawPhone);
  const dob = leadFact(values, ...DOB_KEYS);
  const born = dob ? bornLine(dob) : null;
  const age = leadFact(values, "age") ?? (ageFromDob(dob)?.toString() ?? null);
  const city = leadFact(values, "city");
  const state = leadFact(values, "state");
  const place = [city, state].filter(Boolean).join(", ");
  const sub = [age ? `${age} yrs` : null, place || null, codeLabel(w?.lead.product_line)].filter(Boolean).join(" · ");
  const chip = screeningChip(w?.screening ?? null);
  const at = w?.stage ? w.stages.findIndex((s) => s.id === w.stage?.id) : -1;
  const showCall = canDial && (w ? !w.readOnly : me?.role === "setter");
  const showSchedule = Boolean(w && !w.readOnly && SCHEDULERS.includes(me?.role ?? ""));
  const canMove = Boolean(w && !w.readOnly && MOVERS.includes(me?.role ?? ""));
  // Board D3: ⋯ always; the menu itself offers only what the server's actions allow (Copy lead ID at least).
  const hasMenu = Boolean(w);
  const composing = (tab === "activity" || tab === "conversation") && w && !w.readOnly;
  const bar = !composing && tab === "details" && (showCall || showSchedule);

  const activity: TimelineItem[] = useMemo(() => {
    if (!w) return [];
    const dayAgo = openedAt - 86_400_000;
    const partner = w.partner?.name ?? null;
    const fromNotes = (notes.data?.notes ?? []).filter((n) => n.body).map((n) => ({
      id: `note:${n.id}`, at: n.createdAt, title: "Note",
      meta: [`“${n.body}”`, firstName(n.author.name), n.visibility === "shared" ? (partner ? `shared with ${partner}` : "shared") : "team", eventWhen(n.createdAt, openedAt)].join(" · "),
    }));
    // The notes list is the notes' own words; the timeline's note rows would repeat them.
    const fromTimeline = w.timeline.filter((e) => !(notes.data && e.id.startsWith("note:"))).map((e) => {
      // "Moved to Interested" (board D4) when the event names the stage it moved to.
      const moved = moveTitle(e.label, e.detail, w.stages);
      return {
        id: e.id, at: e.at, title: moved ?? eventTitle(e.label),
        meta: [e.actor, moved ? null : readableDetail(e.detail, w.stages), eventWhen(e.at, openedAt)].filter(Boolean).join(" · "),
      };
    });
    return [...fromTimeline, ...fromNotes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 40)
      .map((e) => ({ id: e.id, title: e.title, meta: e.meta, muted: Date.parse(e.at) < dayAgo }));
  }, [w, notes.data, openedAt]);

  const street = leadFact(values, "address", "street_address", "address_line_1", "street");
  const address = street ? (city && !street.toLowerCase().includes(city.toLowerCase()) ? `${street}, ${city}` : street) : null;
  const language = leadFact(values, "language", "preferred_language");
  const lineage = w?.lineage ?? null;

  function copy(text: string, done: string) {
    void Clipboard.setStringAsync(text).then(() => setToast(done), () => setToast("Could not copy"));
  }

  const top = w ? (
    <View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={2} style={{ fontFamily: F.db, fontSize: 28, lineHeight: 33, letterSpacing: -0.56, color: p.ink }}>{name}</Text>
          {sub ? <Text style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>{sub}</Text> : null}
        </View>
        {chip ? <Chip tone={chip.tone}>{chip.text}</Chip> : null}
      </View>
      {w.stages.length > 1 && at >= 0 ? <StagePath testID="lead-stage-path" stages={w.stages} current={at} onPick={canMove ? (i) => setMoveTo(w.stages[i]) : undefined} /> : null}
      <View style={{ height: 12 }} />
      <UnderTabs items={TABS} value={tab} onChange={(k) => setTab(k as TabKey)} />
    </View>
  ) : null;

  // What happens next: the server's readiness answers (board D3: consent, coverage, beneficiary, bank).
  // An older server sends none; then the scheduled touch, the quote and the verification, as before.
  const steps: { icon: IconName; done: boolean; text: string }[] = [];
  if (w && w.readiness) {
    for (const line of readinessLines(w.readiness)) steps.push({ icon: line.done ? "checkC" : "clock", done: line.done, text: line.text });
  } else if (w) {
    const next = nextLine(w.nextAction ?? null);
    if (next) steps.push({ icon: "clock", done: false, text: next });
    // Money never shows cents (owner rule).
    steps.push(w.quotedMonthlyCents != null ? { icon: "checkC", done: true, text: `Quoted · $${Math.round(w.quotedMonthlyCents / 100).toLocaleString()} a month` } : { icon: "clock", done: false, text: "No quote yet" });
    const v = w.verification ?? null;
    if (!v) steps.push({ icon: "clock", done: false, text: "Not verified yet" });
    else if (v.session.completed_at || v.session.progress_percentage >= 100) steps.push({ icon: "checkC", done: true, text: "Verified" });
    else steps.push({ icon: "clock", done: false, text: `Verification ${Math.round(v.session.progress_percentage)}% done` });
  }

  const details = w ? (
    <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 12 }}>
      <Card>
        <KV pairs={[
          ...(phone && rawPhone ? [["Phone", (
            <View key="phone" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 15, lineHeight: 20, color: p.ink, fontVariant: ["tabular-nums"] }}>{phone}</Text>
              <Pressable testID="lead-copy-phone" accessibilityRole="button" accessibilityLabel="Copy the phone number" hitSlop={8} onPress={() => copy(rawPhone, "Phone number copied")}>
                <Text style={{ fontFamily: F.s, fontSize: 15, lineHeight: 20, color: p.greenInk }}>Copy</Text>
              </Pressable>
            </View>
          )] as [string, ReactNode]] : []),
          ...(born ? [["Born", born] as [string, string]] : []),
          ...(address ? [["Address", address] as [string, string]] : []),
          ...(language ? [["Language", language] as [string, string]] : []),
          ["Owner", w.owner ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Avatar initials={initials(w.owner.name)} size={26} />
              <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>{w.owner.name}</Text>
            </View>
          ) : "Unassigned"],
        ]} />
      </Card>
      <Card>
        <CardTitle>What happens next</CardTitle>
        <View testID="lead-next" style={{ gap: 9, marginTop: 10 }}>
          {steps.map((s) => (
            <View key={s.text} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name={s.icon} size={18} color={s.done ? p.ok : p.faint} />
              <Text style={{ flex: 1, fontFamily: F.r, fontSize: 15, lineHeight: 20, color: s.done ? p.ink : p.muted }}>{s.text}</Text>
            </View>
          ))}
        </View>
        <ApplicationEntry leadId={w.lead.id} workItem={w.queue} currentUserId={w.currentUserId ?? me?.user.id ?? ""}
          canStart={!w.readOnly && (me?.role === "owner" || me?.role === "producer")} />
      </Card>
      {lineage && (lineage.vendorName || lineage.campaignName || lineage.sourceType || w.partner) ? (
        <Card>
          <CardTitle>{`Where ${they} came from`}</CardTitle>
          <View style={{ marginTop: 8 }}>
            <KV pairs={[
              ...(w.partner ? [["Partner", w.partner.name] as [string, string]] : []),
              ...(lineage.vendorName ? [["Vendor", lineage.vendorName] as [string, string]] : []),
              ...(lineage.campaignName ? [["Campaign", lineage.campaignName] as [string, string]] : []),
              ...(lineage.sourceType ? [["Source", sourceKind(lineage.sourceType) ?? lineage.sourceType] as [string, string]] : []),
              // Cost with cents, as the board draws it ("$28.00 · 19 Nov"); null for a role that may not see money.
              ...(lineage.costCents != null ? [["Cost", [usdCents(lineage.costCents), lineage.costAt ? dayMonth(lineage.costAt) : null].filter(Boolean).join(" · ")] as [string, string]] : []),
            ]} />
          </View>
        </Card>
      ) : w.partner ? (
        <Card>
          <CardTitle>{`Where ${they} came from`}</CardTitle>
          <View style={{ marginTop: 8 }}><KV pairs={[["Partner", w.partner.name]]} /></View>
        </Card>
      ) : null}
    </View>
  ) : null;

  const activityBody = (
    <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
      {activity.length ? <Timeline items={activity} /> : <Empty icon="activity" title="Nothing yet" body="Calls, moves and notes land here, newest first." />}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      {/* The page draws the board's own header (back, the name, the path, the tabs), not the stack's. */}
      {embedded ? null : <Stack.Screen options={{ headerShown: false }} />}
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <Header back={embedded ? undefined : "Leads"} onBack={embedded ? undefined : router.back} large={false} title="" belowFull={top}
          actions={[
            ...(hasMenu ? [{ icon: "moreH" as const, label: "More actions", onPress: () => setMenu(true) }] : []),
            ...(onClose ? [{ icon: "x" as const, label: "Close the lead", onPress: onClose }] : []),
          ]} />
        {lead.loading && !w ? (
          // Board M1: the skeleton rows while the lead loads, outside the scroller so they draw at once.
          <View testID="lead-loading" style={{ flex: 1, paddingTop: 8 }}><Loading rows={5} /></View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: 40 + (bar ? 74 + insets.bottom : 0) }}
            refreshControl={<RefreshControl refreshing={lead.refreshing} onRefresh={() => { void lead.refresh(); void notes.reload(); }} tintColor={p.green} colors={[p.green]} progressBackgroundColor={p.surf} />}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {lead.error && !w ? (
              me?.role === "setter" ? <Empty icon="phone" title="Ready to call" body="Your role works the lead from the call: the script, the disclosure and the outcome." />
                : lead.errorCode?.status === 404 || lead.errorCode?.status === 403 ? <Empty icon="lock" title="This lead isn’t yours to open" body="It may be with another producer now." /> : <Failed message={lead.error} onRetry={lead.reload} />
            ) : !w ? null : tab === "details" ? details : tab === "activity" ? activityBody
              : tab === "conversation" ? <ConversationTab w={w} notes={notes.data?.notes ?? []} />
              : tab === "nurture" ? <NurtureTab leadId={w.lead.id} owner={w.owner?.name ?? null} pronoun={they} />
              : tab === "verification" ? <VerificationTab w={w} />
              : <ApplicationTab leadId={w.lead.id} workItem={w.queue} currentUserId={w.currentUserId ?? me?.user.id ?? ""} canStart={!w.readOnly && (me?.role === "owner" || me?.role === "producer")} />}
          </ScrollView>
        )}
        {composing ? (
          <Composer value={note} onChange={setNote} onSend={addNote} busy={saving}
            placeholder={tab === "conversation" && w?.partner ? `Message ${w.partner.name} about ${firstName(name)}` : "Add a note for the team…"} />
        ) : bar || (showCall && !w && !lead.loading) ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 + insets.bottom, backgroundColor: p.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
            {showSchedule ? <View style={{ flex: 1 }}><Button testID="lead-schedule" label="Schedule" icon="calCheck" kind="outline" onPress={() => setScheduling(true)} /></View> : null}
            {showCall ? <View style={{ flex: 1 }}><Button testID="lead-call" label={name ? `Call ${firstName(name)}` : "Call"} icon="phone" kind="primary" onPress={() => setCalling(true)} /></View> : null}
          </View>
        ) : null}
      </View>
      {canDial && calling ? <CallSheet leadId={id} visible onClose={() => setCalling(false)} onSaved={() => { void lead.reload(); counts.refresh(); }} /> : null}
      {w && showSchedule ? (
        <ScheduleSheet visible={scheduling} leadId={w.lead.id} firstName={firstName(name)} onClose={() => setScheduling(false)}
          onBooked={(message) => { setScheduling(false); setToast(message); void lead.reload(); void notes.reload(); counts.refresh(); }} />
      ) : null}
      {w ? <LeadMenu visible={menu} onClose={() => setMenu(false)} w={w} onDone={(message) => { if (message) setToast(message); void lead.reload(); }} /> : null}
      {w ? (
        <MoveSheet visible={Boolean(moveTo)} leadId={w.lead.id} firstName={firstName(name)} from={w.stage} to={moveTo} source="lead_detail" pronoun={they}
          callback={w.nextAction?.kind === "callback" ? { at: w.nextAction.at, timezone: w.nextAction.timezone } : null}
          onClose={() => setMoveTo(null)} onMoved={(message) => { setMoveTo(null); setToast(message); void lead.reload(); void notes.reload(); counts.refresh(); }} />
      ) : null}
      <Toast text={toast} onHide={() => setToast(null)} bottom={90 + insets.bottom} />
    </KeyboardAvoidingView>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
