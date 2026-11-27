import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Haptics from "expo-haptics";

import { CallSheet } from "@/components/call-sheet";
import { CallbackDetail } from "@/components/calls/callback-detail";
import { DialogModal, Fab, FigureChip, Legend, Mini, Snack, SwitchChip, ToneGroup, WeekStrip } from "@/components/calls/parts";
import { ScheduleCallback } from "@/components/calls/schedule-callback";
import { addDays, clearUntil, clock, dayKey, dayOfMonth, deviceZone, lateLabel, weekday, zoneShort } from "@/components/calls/time";
import { appointmentMeta } from "@/components/calendar/appointment";
import type { CalendarAppointment } from "@/components/calendar/month";
import { ChecksSheet, LeadChecksSheet } from "@/components/dialer/checks-sheet";
import { HeadCard, queueMeta, rowChip, type HeadPanel, type QueueRow } from "@/components/dialer/head-card";
import { isKind, QueueSheet, type LeadKind, type Priority } from "@/components/dialer/queue-sheet";
import { Icon } from "@/components/icon";
import { CallsSplit, useLeadSelected, useShowLead } from "@/components/native/record-split";
import { handoffLine, waitingLine } from "@/components/inbound/model";
import { OnCallBar } from "@/components/inbound/on-call-bar";
import { TransferRinger, useRinger } from "@/components/inbound/ringer";
import { TransferDetails } from "@/components/inbound/transfer-details";
import { Button, Card, Chip, Empty, F, Failed, Group, Header, IOS, Loading, Row, Screen, SectionHead, Segments, T, Toggle, type HeaderAction } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCounts } from "@/lib/counts";
import { callbackOpen, displayName, firstName } from "@/lib/format";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { CallbacksAnswer, CallbackView, ClaimAnswer, ServedAnswer, WaitingAnswer } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import type { Tone } from "@/theme/tokens";

/**
 * Board C1 / C7 / C10 / C11 / C12: Today on the web becomes one Calls tab — Incoming transfers, the
 * Dialer, Callbacks — behind one switch under the title. Which parts show follows the server's gates.
 */
type Part = "incoming" | "dialer" | "callbacks";
const LABELS: Record<Part, string> = { incoming: "Incoming", dialer: "Dialer", callbacks: "Callbacks" };

/** Board L6: on a tablet the dialer and callbacks sit left of the lead they show; a phone is unchanged. */
export default function CallsTab() {
  return <CallsSplit><Calls /></CallsSplit>;
}

/**
 * The same Calls as a pushed screen (/calls-page) with a back arrow, for the roles whose tab bar has no
 * Calls (owner and admin on Team · Money): a hidden tab cannot be opened, it falls back to Home.
 */
export function CallsPage() {
  return <CallsSplit><Calls stacked /></CallsSplit>;
}

function Calls({ stacked }: { stacked?: boolean }) {
  const { me } = useSession();
  const counts = useCounts();
  const params = useLocalSearchParams<{ part?: string }>();
  const parts = callsPartsFor(me?.role, me?.plan?.features);
  const asked = parts.includes(params.part as Part) ? (params.part as Part) : parts[0];
  // A link (push, Home tile) names the part; a tap on the switch overrides it until the next link.
  const [picked, setPicked] = useState<{ for: Part; part: Part } | null>(null);
  const part = picked && picked.for === asked ? picked.part : asked;
  const setPart = (next: Part) => setPicked({ for: asked, part: next });
  const [priority, setPriority] = useState<Priority>("all");
  const [filters, setFilters] = useState<QueueSheetState>("closed");
  // The web dialer's Auto-next, on by default: kept while the app is open, across the parts.
  const [autoNext, setAutoNext] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);
  const c = counts.nav?.counts ?? {};
  const canSchedule = ["owner", "producer", "assistant"].includes(me?.role ?? "");
  const count: Record<Part, number | undefined> = { incoming: c["leads.inbound"], dialer: undefined, callbacks: c["sell.callbacks"] };
  const seg = parts.length > 1 ? <Segments items={parts.map((k) => ({ key: k, label: LABELS[k], count: count[k] }))} value={part} onChange={(k) => setPart(k as Part)} /> : null;
  // Only controls that do something real. C1: sliders opens the Inbound team (C1c: who takes calls and
  // in what order); C7: search and the queue filters (C7e, one sheet); C11: the calendar (C13), and on
  // iOS the + that Android draws as the Schedule button.
  const actions: HeaderAction[] = part === "incoming" ? [{ icon: "sliders", label: "Inbound team", onPress: () => router.push("/call/team" as Href) }]
    : part === "dialer" ? [{ icon: "search", label: "Search leads", onPress: () => setFilters("search") }, { icon: "sliders", label: "Queue filters", onPress: () => setFilters("open") }]
    : part === "callbacks" ? [{ icon: "calendar", label: "Calendar", onPress: () => router.push("/calendar" as Href) }, ...(IOS && canSchedule ? [{ icon: "plus" as const, label: "Schedule a callback", onPress: () => setScheduling(true) }] : [])] : [];
  const header = (
    <Header title="Calls" actions={actions} onBack={stacked ? () => router.back() : undefined} large={stacked ? true : undefined}
      belowFull={seg ? (IOS ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>{seg}</View> : <View style={{ paddingTop: 10 }}>{seg}</View>) : undefined} />
  );
  return (
    <View style={{ flex: 1 }}>
      <Screen header={header}>
        {/* Board L2: a call in progress (a transfer or a dialer call) shows above every part. */}
        <OnCallBar />
        {part === "incoming" ? <Incoming />
          : part === "dialer" ? <Dialer priority={priority} setPriority={setPriority} filters={filters} setFilters={setFilters} autoNext={autoNext} setAutoNext={setAutoNext} />
          : <Callbacks role={me?.role} scheduling={scheduling} setScheduling={setScheduling} onToast={setToast} />}
      </Screen>
      {/* C11 · Android's Schedule button floats over the list (iOS has the + in the bar). */}
      {part === "callbacks" && !IOS && canSchedule ? <Fab testID="callbacks-schedule" label="Schedule" icon="plus" onPress={() => setScheduling(true)} /> : null}
      {toast ? <Snack text={toast} bottom={part === "callbacks" && !IOS ? 84 : 16} /> : null}
    </View>
  );
}

// ─── C1 · Incoming ─────────────────────────────────────────────────────────────────────────────
type Handoff = { id: string; workItemId: string; bufferName: string; customer: string; productLine: string | null; progressPercentage: number | null; offeredAt?: string | null; expiresAt: string | null };
type Waiting = WaitingAnswer & { handoffs?: Handoff[]; receivedAt: number };
type Presence = "ready" | "on_break" | "on_call" | "off";

const SCREENING_TONE: Record<string, Tone> = { "DNC clear": "ok", "Needs review": "warn", Duplicate: "warn" };

function mss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Board C1: your availability, the next caller, everyone waiting (longest first), handoffs for you. */
function Incoming() {
  const p = usePalette();
  const { api } = useSession();
  const counts = useCounts();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ring = useRinger();
  const saved = counts.nav?.presence as Presence | null | undefined;
  // Board C1 always draws the availability card: no presence row on the server is "not taking calls".
  const status: Presence | null = presence ?? (counts.nav ? saved ?? "off" : null);
  // Board C2: every read can ring this phone for a transfer that is new since the last one.
  const waiting = useLoad(() => api<WaitingAnswer & { handoffs?: Handoff[] }>("/api/app/inbound/waiting").then((d): Waiting => {
    ring.observe(d.items, status, Boolean(d.readOnly));
    return { ...d, receivedAt: Date.now() };
  }), [], { every: 5000 });
  // The wait counts up between the five-second reads, from the server's own figure.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function setAvailable(on: boolean) {
    const next: Presence = on ? "ready" : "off";
    setPresence(next);
    try {
      await api("/api/app/agent-floor", { method: "POST", body: { action: "presence", status: next } });
      counts.refresh();
    } catch (e) {
      setPresence(null);
      Alert.alert("Not changed", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  async function claim(id: string | null) {
    setClaiming(id ?? "next");
    try {
      const answer = id
        ? await api<ClaimAnswer>("/api/app/inbound/claim", { method: "POST", body: { work_item_id: id } })
        : await api<ClaimAnswer>("/api/app/inbound/claim-next", { method: "POST", body: {} });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      counts.refresh();
      ring.stop();
      setDetails(null);
      // Board C3: a claim opens the call at Caller profile (the web's /app/inbound/call/<id>).
      router.push(`/call/${answer.claim.work_item_id ?? id}` as Href);
    } catch (e) {
      Alert.alert("Not claimed", e instanceof ApiError ? e.message : "Try again.");
      void waiting.reload();
    } finally {
      setClaiming(null);
    }
  }

  async function accept(h: Handoff) {
    setClaiming(h.id);
    try {
      await api("/api/app/inbound/handoff", { method: "POST", body: { action: "accept", handoff_id: h.id } });
      counts.refresh();
      void waiting.reload();
      // The call is yours now: it opens where the assistant left it, at Verification.
      router.push(`/call/${h.workItemId}?phase=verify` as Href);
    } catch (e) {
      Alert.alert("Not accepted", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setClaiming(null);
    }
  }

  if (waiting.loading && !waiting.data) return <Loading rows={3} />;
  if (waiting.error && !waiting.data) {
    if (waiting.errorCode?.status === 403) return <Empty icon="lock" title="Transfers aren’t on for you" body="Your agency’s plan or your role doesn’t include live transfers." />;
    // Board M3: says what failed, and what still holds while the phone is offline.
    return <Failed what="incoming calls" message={waiting.errorCode?.status === 0 ? "The connection dropped while loading. Transfers are still being held for you for 60 seconds." : waiting.error} onRetry={waiting.reload} />;
  }
  const items = waiting.data?.items ?? [];
  const handoffs = waiting.data?.handoffs ?? [];
  const readOnly = Boolean(waiting.data?.readOnly);
  const since = (now - (waiting.data?.receivedAt ?? now)) / 1000;
  const taking = status === "ready" || status === "on_call";
  const ringing = ring.ringing ? items.find((it) => it.id === ring.ringing) ?? null : null;
  const open = details ? items.find((it) => it.id === details) ?? null : null;

  return (
    <View>
      {status ? (
        <View style={{ paddingHorizontal: 16, marginTop: IOS ? 0 : 12 }}>
          {/* Board C1c: the availability card opens the Inbound team. */}
          <Card onPress={() => router.push("/call/team" as Href)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: status === "ready" ? p.green : status === "on_call" ? p.info : status === "on_break" ? p.warn : p.faint }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{status === "ready" ? "You’re taking calls" : status === "on_call" ? "You’re on a call" : status === "on_break" ? "You’re on a break" : "You’re not taking calls"}</Text>
                <Mini>{status === "ready" ? "Next transfer rings this phone" : status === "on_call" ? "Transfers wait until you’re free" : "Turn on to take transfers"}</Mini>
              </View>
            </View>
            {!readOnly ? <Toggle label="Taking calls" value={taking} onChange={(v) => void setAvailable(v)} /> : null}
          </Card>
        </View>
      ) : null}

      {items.length && !readOnly ? (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <Button testID="incoming-take-next" kind="gold" label="Take the next caller" icon="phoneIn" onPress={() => void claim(null)} busy={claiming === "next"} disabled={Boolean(claiming)} />
        </View>
      ) : null}

      {items.length ? (
        <>
          <SectionHead>Waiting now</SectionHead>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {items.map((it) => (
              <Card key={it.id}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 17, color: p.ink }}>{it.customer}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 14, color: p.muted }}>{waitingLine(it)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: F.db, fontSize: 22, lineHeight: 26, letterSpacing: -0.44, color: p.ink, fontVariant: ["tabular-nums"] }}>{mss(it.waitSeconds + since)}</Text>
                    <Mini>waiting</Mini>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    {it.partnerName ? <><Icon name="handshake" size={15} color={p.muted} /><Mini>{it.partnerName}</Mini></> : null}
                  </View>
                  {it.screening ? <Chip tone={SCREENING_TONE[it.screening] ?? "neutral"}>{it.screening}</Chip> : null}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <Button testID={`incoming-details-${it.id}`} small kind="outline" label="Details" onPress={() => setDetails(it.id)} style={{ flex: 1, alignSelf: "stretch" }} />
                  {!readOnly ? <Button write testID={`incoming-claim-${it.id}`} small label="Claim" icon="phoneIn" onPress={() => void claim(it.id)} busy={claiming === it.id} disabled={Boolean(claiming)} style={{ flex: 1, alignSelf: "stretch" }} /> : null}
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {handoffs.length ? (
        <>
          <SectionHead>Handoffs for you</SectionHead>
          <Group>
            {handoffs.map((h, i) => (
              <Row key={h.id} first={i === 0} icon="userPlus" iconTone="gold" title={`${displayName(h.customer)} from ${firstName(h.bufferName) || h.bufferName} (assistant)`}
                meta={handoffLine(h, now)}
                chip={readOnly ? undefined : <Button write testID={`handoff-accept-${h.id}`} small kind="tonal" label="Accept" onPress={() => void accept(h)} busy={claiming === h.id} disabled={Boolean(claiming)} style={{ height: 32 }} />} />
            ))}
          </Group>
        </>
      ) : null}

      {!items.length && !handoffs.length ? <Empty icon="phoneIn" title="No transfers waiting" body="When one comes in, this phone rings, even when the app is closed." /> : null}

      {open ? (
        <TransferDetails item={open} wait={open.waitSeconds + since} readOnly={readOnly} busy={claiming === open.id}
          onClaim={() => void claim(open.id)} onClose={() => setDetails(null)} />
      ) : null}
      <TransferRinger item={ringing} wait={ringing ? ringing.waitSeconds + since : 0} busy={Boolean(ringing && claiming === ringing.id)}
        onTake={() => { if (ringing) void claim(ringing.id); }} onPass={() => { if (ringing) ring.pass(ringing.id); }} />
    </View>
  );
}

// ─── C7 · Dialer, C7b · checks, C7e · queue filters, C10 · blocked ─────────────────────────────
type QueueAnswer = {
  available?: boolean; message?: string; count?: number; capped?: boolean; rows?: QueueRow[]; stats: { dials: number; contacts: number } | null; emptyReason: string | null;
  /** Applications this agent started today (2026-11-26, additive); null when it could not be counted. */
  apps?: number | null;
};
export type QueueSheetState = "closed" | "open" | "search";

function Dialer({ priority, setPriority, filters, setFilters, autoNext, setAutoNext }: {
  priority: Priority; setPriority: (p: Priority) => void;
  /** The queue sheet: closed, open, or open with the search focused (the header's search). */
  filters: QueueSheetState; setFilters: (v: QueueSheetState) => void;
  autoNext: boolean; setAutoNext: (v: boolean) => void;
}) {
  // Board L6: on a tablet a row in Up next previews its lead on the right; on a phone it serves the lead.
  const showLead = useShowLead();
  const isOpen = useLeadSelected();
  const { api } = useSession();
  const counts = useCounts();
  const queue = useLoad(() => api<QueueAnswer>(`/api/app/dialer/queue?priority=${priority}`), [priority]);
  // Leads passed over on this phone (Skip, or just dialled): the list moves on without them.
  const [passed, setPassed] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [kind, setKind] = useState<LeadKind | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [calling, setCalling] = useState<{ leadId: string; workItemId: string | null } | null>(null);
  const [blocked, setBlocked] = useState<{ message: string; workItemId: string | null; leadId: string } | null>(null);
  const [checks, setChecks] = useState<{ panel: HeadPanel } | { leadId: string } | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);

  const listed = (queue.data?.rows ?? []).filter((r) => !passed.includes(r.workItemId));
  const rows = listed.filter((r) => (!campaign || r.campaignName === campaign) && (!kind || isKind(r, kind)));
  // A campaign or lead type narrows the list the server sent (at most its first hundred), so its count is that list's.
  const total = campaign || kind ? rows.length : Math.max(rows.length, (queue.data?.count ?? 0) - passed.length);
  const head = rows[0] ?? null;
  const next = all ? rows.slice(1) : rows.slice(1, 5);
  const pass = (id: string | null) => { if (id) setPassed((xs) => (xs.includes(id) ? xs : [...xs, id])); };

  /** Serve THIS lead (POST /api/app/dialer/pick): the server locks it and runs every serve gate first. */
  async function pick(row: QueueRow) {
    setBusy(row.workItemId);
    try {
      const answer = await api<{ served: { leadId: string } | null; error?: string }>("/api/app/dialer/pick", { method: "POST", body: { work_item_id: row.workItemId } });
      if (answer.served) setCalling({ leadId: answer.served.leadId, workItemId: row.workItemId });
      else {
        // The server's serve gate said no: the one blocked-dial buzz, as when the request itself fails.
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        setBlocked({ message: answer.error ?? "This lead can’t be served right now.", workItemId: row.workItemId, leadId: row.leadId });
      }
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      setBlocked({ message: e instanceof ApiError ? e.message : "This lead can’t be served right now.", workItemId: row.workItemId, leadId: row.leadId });
    } finally {
      setBusy(null);
    }
  }

  /** Without the list (before its migration): Serve next lead, the server's own pick. */
  async function serve() {
    setBusy("serve");
    setEmpty(null);
    try {
      const answer = await api<ServedAnswer>("/api/app/dialer/next", { method: "POST" });
      if (answer.served) { counts.refresh(); setCalling({ leadId: answer.served.leadId, workItemId: answer.served.workItemId }); }
      else setEmpty(answer.atCapacity ? `You have ${answer.atCapacity.open} leads open, the most allowed at once. Finish one first.` : answer.emptyReason ?? "Nothing to dial right now.");
    } catch (e) {
      setEmpty(e instanceof ApiError ? e.message : "Couldn’t serve a lead. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const sheet = calling ? (
    <CallSheet leadId={calling.leadId} visible backLabel="Dialer"
      onClose={() => setCalling(null)}
      onSaved={() => { pass(calling.workItemId); counts.refresh(); queue.reload(); }}
      onSkip={() => pass(calling.workItemId)}
      // Auto-next (the web dialer's switch): saving an outcome serves the next lead on the list.
      onNext={autoNext && queue.data?.rows ? () => { const n = rows.find((r) => r.workItemId !== calling.workItemId); if (n) void pick(n); } : undefined} />
  ) : null;

  const filterSheet = (
    <QueueSheet visible={filters !== "closed"} focusSearch={filters === "search"} onClose={() => setFilters("closed")}
      priority={priority} onPriority={setPriority} campaign={campaign} onCampaign={setCampaign} campaigns={listed.map((r) => r.campaignName)}
      kind={kind} onKind={setKind}
      autoNext={autoNext} onAutoNext={setAutoNext} showing={total} loading={queue.loading}
      onOpenLead={(leadId) => setCalling({ leadId, workItemId: null })} />
  );

  const blockedDialog = (
    <DialogModal visible={Boolean(blocked)} onClose={() => setBlocked(null)} title="We can’t call this number" body={blocked?.message ?? ""}
      actions={[
        { label: "Skip to the next lead", bold: true, onPress: () => { pass(blocked?.workItemId ?? null); setBlocked(null); }, testID: "dialer-skip-next" },
        { label: "See the checks", onPress: () => { if (blocked) setChecks({ leadId: blocked.leadId }); setBlocked(null); }, testID: "dialer-see-checks" },
      ]} />
  );

  const checksSheet = checks ? ("panel" in checks ? <ChecksSheet panel={checks.panel} onClose={() => setChecks(null)} /> : <LeadChecksSheet leadId={checks.leadId} onClose={() => setChecks(null)} />) : null;

  if (queue.loading && !queue.data) return <Loading rows={4} />;
  if (queue.error && !queue.data) {
    if (queue.errorCode?.status === 403) return <Empty icon="lock" title="The dialer isn’t on for you" body="Your agency’s plan or your role doesn’t include outbound calling." />;
    return <Failed what="the dialer" message={queue.error} onRetry={queue.reload} />;
  }

  // Board C7's strip: today's own figures (GET /api/app/dialer/queue stats), then the Auto-next switch.
  const stats = queue.data?.stats;
  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} style={{ marginTop: IOS ? 0 : 12 }}>
      {stats ? <FigureChip label="Called" n={stats.dials} /> : null}
      {stats ? <FigureChip label="Contacts" n={stats.contacts} /> : null}
      {queue.data?.apps != null ? <FigureChip label="Apps" n={queue.data.apps} /> : null}
      <SwitchChip testID="dialer-auto-next" label="Auto-next" icon="skip" value={autoNext} onChange={setAutoNext} />
    </ScrollView>
  );

  // The list needs a database update on older installs; Serve next still works without it.
  if (queue.data && queue.data.available === false) {
    return (
      <View>
        {chips}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
          <Button kind="gold" label="Serve next lead" icon="phoneOut" onPress={() => void serve()} busy={busy === "serve"} />
          {empty ? <T kind="small">{empty}</T> : <Mini>The server checks this number again just before dialing.</Mini>}
        </View>
        {filterSheet}
        {sheet}
      </View>
    );
  }

  return (
    <View>
      {chips}
      {head ? (
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <HeadCard row={head} position={1} total={total} busy={Boolean(busy)}
            onSkip={() => pass(head.workItemId)} onCall={() => void pick(head)} onDetails={(panel) => setChecks({ panel })} />
        </View>
      ) : (
        <Empty icon="check" title="Nothing to dial right now" body={priority !== "all" || campaign || kind ? "Try All in the queue filters." : queue.data?.emptyReason ?? undefined} />
      )}

      {next.length ? (
        <>
          <SectionHead link={!all && total - 1 > next.length ? `${(total - 1).toLocaleString()} more` : undefined} onLink={() => setAll(true)}>Up next</SectionHead>
          <Group>
            {next.map((r, i) => (
              <Row key={r.workItemId} testID={`dialer-row-${r.workItemId}`} first={i === 0} icon="user" iconTone="plain" title={displayName(r.name) ?? "Unnamed lead"}
                meta={queueMeta(r)} chip={rowChip(r) ? <Chip tone={rowChip(r)!.tone}>{rowChip(r)!.label}</Chip> : undefined} onPress={busy ? undefined : () => { if (!showLead(r.leadId)) void pick(r); }} selected={isOpen(r.leadId)} />
            ))}
          </Group>
        </>
      ) : null}
      {filterSheet}
      {blockedDialog}
      {checksSheet}
      {sheet}
    </View>
  );
}

// ─── C11 · Callbacks, C12 · Callback detail ────────────────────────────────────────────────────
type CallbacksData = CallbacksAnswer & { viewerTimezone?: string | null };
type ListItem = { kind: "callback"; at: Date; cb: CallbackView } | { kind: "appointment"; at: Date; a: CalendarAppointment };

function Callbacks({ role, scheduling, setScheduling, onToast }: { role: string | undefined; scheduling: boolean; setScheduling: (v: boolean) => void; onToast: (text: string) => void }) {
  const p = usePalette();
  const { api, me } = useSession();
  const counts = useCounts();
  const showLead = useShowLead();
  const list = useLoad(() => api<CallbacksData>("/api/app/callbacks"), []);
  const [now] = useState(() => Date.now());
  // Board C11 shows the week's appointments among the callbacks (the web Calendar's two kinds). A role
  // without the calendar (the server's gate) sees callbacks only.
  const week = useLoad(() => api<{ appointments: CalendarAppointment[] }>(`/api/app/calendar?from=${encodeURIComponent(new Date(now - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(now + 8 * 86_400_000).toISOString())}`)
    .catch((e: unknown) => { if (e instanceof ApiError && e.status === 403) return { appointments: [] as CalendarAppointment[] }; throw e; }), [now]);
  const [open, setOpen] = useState<CallbackView | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  // The week strip picks a day: today (and tomorrow) show the board's Overdue · Today · Tomorrow; a later
  // day shows Overdue and that day, so nothing booked this week is out of reach.
  const [picked, setPicked] = useState<string | null>(null);
  if (list.loading && !list.data) return <Loading rows={4} />;
  if (list.error && !list.data) return <Failed what="your callbacks" message={list.error} onRetry={list.reload} />;

  const viewer = list.data?.viewer.userId;
  const mine = list.data?.viewerTimezone || deviceZone();
  const today = dayKey(new Date(now), mine);
  const tomorrow = addDays(today, 1);
  // The server scopes the list to what this person may see; missed ones still need a call.
  const pending = (list.data?.callbacks ?? []).filter((cb) => callbackOpen(cb.status));
  const late = (cb: CallbackView) => cb.isOverdue || cb.status === "missed";
  const appts = (week.data?.appointments ?? []).filter((a) => (a.status === "booked" || a.status === "confirmed") && Date.parse(a.startsAtUtc) + a.durationMinutes * 60_000 > now && !a.redacted);
  const items: ListItem[] = [
    ...pending.map((cb): ListItem => ({ kind: "callback", at: new Date(cb.scheduledAtUtc), cb })),
    ...appts.map((a): ListItem => ({ kind: "appointment", at: new Date(a.startsAtUtc), a })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());
  const isLate = (it: ListItem) => it.kind === "callback" && late(it.cb);
  const day = (it: ListItem) => dayKey(it.at, mine);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const selected = picked && days.includes(picked) ? picked : today;
  const later = selected > tomorrow;
  const groups: [string, ListItem[], string | undefined][] = later ? [
    ["Overdue", items.filter(isLate), p.warn],
    [`${weekday(selected)} ${dayOfMonth(selected)}`, items.filter((it) => !isLate(it) && day(it) === selected), undefined],
  ] : [
    ["Overdue", items.filter(isLate), p.warn],
    ["Today", items.filter((it) => !isLate(it) && day(it) <= today), undefined],
    ["Tomorrow", items.filter((it) => !isLate(it) && day(it) === tomorrow), undefined],
  ];

  function meta(cb: CallbackView): string {
    const at = new Date(cb.scheduledAtUtc);
    const tz = cb.customerTimezone;
    const someoneElse = cb.assignedTo && cb.assignedTo !== viewer && cb.assigneeName ? cb.assigneeName : null;
    if (!tz) return [cb.customerTime, someoneElse].filter(Boolean).join(" · ");
    const theirs = clock(at, tz);
    const same = theirs === clock(at, mine) && dayKey(at, tz) === dayKey(at, mine);
    const yours = same ? "same as yours" : `${clock(at, mine, !late(cb))} yours`;
    return [`${late(cb) ? "Was " : ""}${theirs} their time (${zoneShort(tz, at)})`, yours, someoneElse].filter(Boolean).join(" · ");
  }

  // Board M2 is the screen when nothing is overdue and nothing is due today; it names the next item, if any.
  const clear = !later && !groups[0][1].length && !groups[1][1].length;
  const next = items.find((it) => !isLate(it)) ?? null;
  const dialer = callsPartsFor(me?.role, me?.plan?.features).includes("dialer");

  const right = (it: ListItem) => clock(it.at, mine, false);

  return (
    <View>
      <View style={{ marginTop: IOS ? 0 : 10 }}>
        <WeekStrip days={days.map((k) => ({ key: k, label: weekday(k, true), num: dayOfMonth(k) }))} value={selected} onPick={(k) => setPicked(k)} dots={new Set(items.map(day))} />
      </View>
      {clear ? (
        // Board M2: nothing overdue and nothing today — say until when, and offer the next useful move.
        <Empty icon="calCheck" title="No callbacks today"
          body={next ? `You’re clear until ${clearUntil(next.at, mine, today)} (${next.kind === "callback" ? displayName(next.cb.customerName) : displayName(next.a.customerName)}). ${dialer ? "Serve the next lead while it’s quiet." : ""}`.trim() : dialer ? "Nothing booked ahead. Serve the next lead while it’s quiet." : "Nothing booked ahead."}
          action={dialer ? <Button write testID="callbacks-serve-next" label="Serve next lead" icon="phoneOut" onPress={() => router.setParams({ part: "dialer" })} /> : undefined} />
      ) : null}
      {later && !groups.some(([, xs]) => xs.length) ? <Empty icon="calCheck" title={`Nothing on ${weekday(selected)} ${dayOfMonth(selected)}`} body="No callbacks or appointments that day." /> : null}
      {clear ? null : groups.filter(([, xs]) => xs.length).map(([label, xs, color]) => (
        <ToneGroup key={label} title={`${label} · ${xs.length}`} color={color}>
          {xs.map((it, i) => it.kind === "callback" ? (
            <Row key={`cb-${it.cb.id}`} testID={`callback-row-${it.cb.id}`} first={i === 0} icon="calCheck" iconTone={late(it.cb) ? "warn" : "brand"} title={displayName(it.cb.customerName)} meta={meta(it.cb)}
              chip={late(it.cb) ? <Chip tone="warn">{lateLabel(now - it.at.getTime())}</Chip> : undefined}
              right={late(it.cb) ? undefined : right(it)}
              onPress={() => { showLead(it.cb.leadId); setOpen(it.cb); }} />
          ) : (
            <Row key={`ap-${it.a.appointmentId}`} testID={`appointment-row-${it.a.appointmentId}`} first={i === 0} icon="calendar" iconTone="info" title={displayName(it.a.customerName)}
              meta={appointmentMeta(it.a, me?.user.id ?? null)} right={right(it)}
              onPress={() => router.push({ pathname: "/appointment/[id]", params: { id: it.a.appointmentId, at: it.a.startsAtUtc } } as never)} />
          ))}
        </ToneGroup>
      ))}
      {items.length ? <Legend items={[{ label: "Scheduled", color: p.info }, { label: "Overdue", color: p.warn }, { label: "Completed", color: p.ok }]} /> : null}
      {open ? (
        <CallbackDetail callback={open} viewerZone={mine} canDial={callsPartsFor(role, me?.plan?.features).includes("dialer")} onClose={() => setOpen(null)}
          onChanged={() => { counts.refresh(); list.reload(); }} onCall={(leadId) => setCalling(leadId)} />
      ) : null}
      {calling ? <CallSheet leadId={calling} visible backLabel="Calls" onClose={() => setCalling(null)} onSaved={() => { counts.refresh(); list.reload(); }} /> : null}
      {scheduling ? <ScheduleCallback onClose={() => setScheduling(false)} onSaved={(m) => { onToast(m); counts.refresh(); list.reload(); }} /> : null}
    </View>
  );
}
