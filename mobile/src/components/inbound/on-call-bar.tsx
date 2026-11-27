import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, type Href } from "expo-router";

import { CallbackPicker } from "@/components/calls/callback-picker";
import { Mini, OutcomeTiles, SheetModal } from "@/components/calls/parts";
import { afterBooking } from "@/components/calls/reminder";
import { clock, zonedLocalToUtc, zoneShort } from "@/components/calls/time";
import { Logo } from "@/components/logo";
import { moveHref, ONGOING_MOVES, ongoingCall, syncOngoingNotification, type DialCallAnswer, type OngoingCall, type OngoingMove } from "@/components/native/ongoing-call";
import { Button, F, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { isQueued } from "@/lib/outbox";
import { currentTabs, reachable } from "@/lib/links";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { barClock } from "./model";
import type { Floor } from "./types";

/**
 * Board L2 · A call in progress: a call from the dialer or a transfer, from the server's own record
 * (components/native/ongoing-call.ts). While one is open the card says so with the call's running time, the board's
 * line ("Term life · TX · attempt 3 · disclosure read") and three moves — Outcome, Add a note (POST
 * /api/app/leads/[id]/notes, as the lead page does) and Callback. A transfer's Outcome and Callback are the call
 * page's Finish step; a dialer call's save its outcome on the attempt (POST /api/app/dialer/attempt/:id/disposition,
 * the dialer's own save). On Android the same call keeps an ongoing notification with the same three buttons; both
 * stop when the outcome is saved.
 *
 * `card={false}` draws nothing and only keeps the notification current, for a layout that wants it on every tab.
 * Read every 15 seconds, and again as the app leaves for the phone's dialer.
 */
const FLOOR_ROLES = ["owner", "producer", "assistant"];
const DIALER_ROLES = ["owner", "producer", "setter"];

export function useOngoingCall(): { call: OngoingCall | null; reload: () => void } {
  const { api, me } = useSession();
  const role = me?.role ?? null;
  const floorOn = FLOOR_ROLES.includes(role ?? "");
  const dialOn = DIALER_ROLES.includes(role ?? "");
  // A failed read keeps the last answer (useLoad), so a moment without signal never clears a call that is still on.
  const floor = useLoad(async () => (floorOn ? api<Floor>("/api/app/agent-floor") : null), [floorOn], { every: 15_000 });
  const dial = useLoad(async () => (dialOn ? api<DialCallAnswer>("/api/app/widget/call") : null), [dialOn], { every: 15_000 });
  const call = ongoingCall(floor.data, dial.data, me?.user.id);
  const settled = !floor.loading && !dial.loading;
  const reloadFloor = floor.reload;
  const reloadDial = dial.reload;

  useEffect(() => {
    // Only once both reads answered: a second copy still loading must never clear the first one's notification.
    // Posts only when the words change (ongoingKey), never every second of the call.
    if (settled) void syncOngoingNotification(call);
  }, [settled, call]);

  useEffect(() => {
    // The dial opens the phone's own dialer: read once more as the app goes, so the notification is up for the call.
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") { reloadFloor(); reloadDial(); } });
    return () => sub.remove();
  }, [reloadFloor, reloadDial]);

  return { call, reload: () => { reloadFloor(); reloadDial(); } };
}

type Ongoing = { call: OngoingCall | null; reload: () => void };
const OngoingContext = createContext<Ongoing | null>(null);

/**
 * One poller for every tab: the tabs layout runs it (and keeps the notification current), and a card under it reads
 * the same answer instead of a second pair of 15-second reads. A screen outside the tabs (/calls-page) has no
 * provider, so its card polls for itself.
 */
export function OngoingCallProvider({ children }: { children: ReactNode }) {
  const value = useOngoingCall();
  return <OngoingContext.Provider value={value}>{children}</OngoingContext.Provider>;
}

export function OnCallBar({ card = true }: { card?: boolean }) {
  const shared = useContext(OngoingContext);
  if (shared) return card && shared.call ? <OnCallCard call={shared.call} reload={shared.reload} /> : null;
  return <OwnOnCallBar card={card} />;
}

function OwnOnCallBar({ card }: { card: boolean }) {
  const { call, reload } = useOngoingCall();
  if (!card || !call) return null;
  return <OnCallCard call={call} reload={reload} />;
}

function OnCallCard({ call, reload }: { call: OngoingCall; reload: () => void }) {
  const p = usePalette();
  const params = useLocalSearchParams<{ oncall?: string }>();
  const [now, setNow] = useState(() => Date.now());
  const [move, setMove] = useState<OngoingMove | null>(null);
  // A move asked for by the notification's button (`?oncall=`), taken once.
  const [handled, setHandled] = useState<string | null>(null);
  const asked = ONGOING_MOVES.find((m) => m.id === params.oncall)?.id ?? null;
  // A transfer's Outcome and Callback go straight to its call page (moveHref), so only these arrive here.
  if (asked && asked !== handled) {
    setHandled(asked);
    if (call.kind === "dialer" || asked === "note") setMove(asked);
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const press = (m: OngoingMove | null) => {
    if (m && (call.kind === "dialer" || m === "note")) { setMove(m); return; }
    router.push((reachable(moveHref(call, m), currentTabs()) ?? moveHref(call, m)) as Href);
  };
  const clockLine = barClock(call.startedAt, now);

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
      <Pressable testID="on-call-bar" accessibilityRole="button" accessibilityLabel={`${call.customer}, ${clockLine}. Open the call`} onPress={() => press(null)}
        style={({ pressed }) => ({ borderRadius: 28, backgroundColor: pressed ? p.surf2 : p.surf, borderWidth: 1, borderColor: p.line, padding: 16 })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#0d4037", alignItems: "center", justifyContent: "center" }}><Logo size={14} /></View>
          <Text testID="on-call-clock" numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.r, fontSize: 12.5, color: p.muted, fontVariant: ["tabular-nums"] }}>{`Insurvas · ${clockLine}`}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 18, color: p.ink, marginTop: 8 }}>{call.customer}</Text>
        {call.line ? <Text testID="on-call-line" numberOfLines={1} style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted }}>{call.line}</Text> : null}
        <View style={{ flexDirection: "row", gap: 18, marginTop: 12 }}>
          {ONGOING_MOVES.map((m) => (
            <Pressable key={m.id} testID={`on-call-${m.id}`} accessibilityRole="button" accessibilityLabel={m.label} hitSlop={8} onPress={() => press(m.id)}>
              <Text style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
      {move === "note" ? <NoteSheet leadId={call.leadId} customer={call.customer} onClose={() => setMove(null)} /> : null}
      {call.kind === "dialer" && (move === "outcome" || move === "callback") ? (
        <DialFinishSheet attemptId={call.id} leadId={call.leadId} customer={call.customer} mode={move} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />
      ) : null}
    </View>
  );
}

/** GET /api/app/dialer/panel, the fields the finish sheet reads. */
type FinishPanel = {
  lead: { state: string | null };
  viewerTimezone?: string | null;
  outcomes: { outcomes: { key: string; label: string; position: number }[] };
  window: { zone: string | null } | null;
};
const CALLBACK = /callback/i;

/**
 * A dialer call's outcome from the card: the agency's outcomes (the dialer panel's own list) or a callback in the
 * customer's time, saved on the attempt the server has open. The same save as the dialer's outcome screen.
 */
export function DialFinishSheet({ attemptId, leadId, customer, mode, onClose, onSaved }: {
  attemptId: string; leadId: string; customer: string; mode: "outcome" | "callback"; onClose: () => void; onSaved: () => void;
}) {
  const { api } = useSession();
  const panel = useLoad(() => api<FinishPanel>(`/api/app/dialer/panel?lead_id=${leadId}`), [leadId]);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const all = [...(panel.data?.outcomes.outcomes ?? [])].sort((a, b) => a.position - b.position);
  const callbackKey = all.find((o) => CALLBACK.test(o.key) || CALLBACK.test(o.label))?.key ?? null;
  // The customer's zone only: a callback is never booked in the phone's zone (the call sheet refuses the same way).
  const zone = panel.data?.window?.zone ?? null;

  async function save(key: string, callbackLocal?: string, options?: { team: boolean; remind: boolean }) {
    if (callbackLocal && !zone) return;
    setBusy(true); setError(null); setChosen(key);
    try {
      const answer = await api<unknown>(`/api/app/dialer/attempt/${attemptId}/disposition`, { method: "POST", body: callbackLocal ? { disposition: key, callback_local: callbackLocal, customer_timezone: zone } : { disposition: key } });
      // Board L4: no signal, so the outcome waits on the phone. Said as such, never as a save.
      if (isQueued(answer)) { setQueued(true); return; }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (callbackLocal && zone && options) {
        const at = zonedLocalToUtc(callbackLocal, zone);
        await afterBooking(api, { leadId, ...options, at, customerName: customer, theirTime: `${clock(at, zone)} their time (${zoneShort(zone, at)})` });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The outcome wasn’t saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible title={mode === "callback" ? `Callback for ${customer}` : `Outcome for ${customer}`} onClose={onClose}>
      <View style={{ gap: 14 }}>
        {panel.error && !panel.data ? <Mini>{panel.error}</Mini> : null}
        {queued ? <Mini>Saved on this phone · sends when you’re back online</Mini> : null}
        {panel.data && mode === "outcome" && !queued ? (
          <OutcomeTiles items={all.filter((o) => o.key !== callbackKey)} value={chosen} disabled={busy} onPick={(key) => void save(key)} />
        ) : null}
        {panel.data && mode === "callback" && !queued ? (
          !callbackKey ? <Mini>Your agency’s outcomes have no callback. Choose Outcome instead.</Mini>
            : !zone ? <Mini>This lead has no time zone yet; book the callback from the computer.</Mini>
            : <CallbackPicker zone={zone} state={panel.data.lead.state} agentZone={panel.data.viewerTimezone} busy={busy} teamOption remindOption onSave={(local, o) => void save(callbackKey, local, o)} />
        ) : null}
        {error ? <Mini>{error}</Mini> : null}
      </View>
    </SheetModal>
  );
}

/** Add a note to the caller's lead while on the call: an internal note, as the lead page writes one. */
export function NoteSheet({ leadId, customer, onClose }: { leadId: string; customer: string; onClose: () => void }) {
  const { api } = useSession();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per note, kept across retries: a retry after a lost answer finds the note it wrote.
  const [key] = useState(() => `app-call-${leadId}-${Date.now().toString(36)}`);

  async function save() {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/app/leads/${leadId}/notes`, { method: "POST", body: { body: text, visibility: "internal", idempotency_key: key } });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved. Check your signal and tap Save again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible title={`Note on ${customer}`} onClose={onClose}>
      <View style={{ gap: 14 }}>
        <Field testID="call-note-input" label="Note" value={body} onChangeText={setBody} multiline autoFocus error={error} />
        <Mini>Saved on the lead’s notes. Your agency sees it; the partner doesn’t.</Mini>
        <Button write testID="call-note-save" label="Save note" onPress={() => void save()} busy={busy} disabled={!body.trim()} />
      </View>
    </SheetModal>
  );
}
