import { useState } from "react";
import { Text, View } from "react-native";

import { Mini, SlotGrid, WeekStrip } from "@/components/calls/parts";
import { addDays, clock, dayKey, dayLabel, dayOfMonth, deviceZone, weekday, zonedLocalToUtc } from "@/components/calls/time";
import { SelectField, Sheet, SheetField } from "@/components/leads/sheets";
import { Between, Button, F, Toggle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

import { OUTCOMES, isUnreached } from "./logic";
import { ChoiceTiles } from "./parts";
import type { CaseDetail } from "./types";

/**
 * Board F5 · Log an attempt, from the case (F4): one outcome, an optional note of what changed, when to try again
 * (the case moves to that day in the list), and the board's switch that marks "Send the change" as done.
 *
 *   POST /api/app/retention/cases {action: "call", outcome, did: "none", note, next_attempt_at, next_attempt_label,
 *   client_calls_carrier} — the call, and on the case's timeline when to try again and that the client will call the
 *   carrier themselves; then {action: "fix", kind: "sent_to_carrier"} when the switch is on, after which the case waits
 *   for a carrier file to prove it.
 *
 * "Try again" is picked in the client's own zone (the server's `clientZone`, from their state), else this phone's.
 */
const SLOTS = [["09:00", "9:00 am"], ["10:00", "10:00 am"], ["11:30", "11:30 am"], ["13:00", "1:00 pm"], ["14:30", "2:30 pm"], ["16:00", "4:00 pm"]] as const;

/** "Wed 25 Nov · 10:00 am their time" (or "your time" when the client's zone isn't known). */
export function retryLabel(at: Date, zone: string, theirs: boolean): string {
  return `${dayLabel(dayKey(at, zone))} · ${clock(at, zone)} ${theirs ? "their" : "your"} time`;
}

export function LogAttemptSheet({ item, visible, onClose, onSaved }: { item: CaseDetail; visible: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const zone = item.clientZone || deviceZone();
  const theirs = Boolean(item.clientZone);
  const [now] = useState(() => Date.now());
  const today = dayKey(new Date(now), zone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  // As drawn: "Reached" is chosen, and Try again is filled with the next day at 10:00 in the client's time (both can
  // be changed or, for Try again, cleared by picking another slot).
  const [outcomeKey, setOutcomeKey] = useState<string | null>(OUTCOMES[0]?.key ?? null);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(days[0]);
  const [pick, setPick] = useState<{ day: string; slot: string } | null>({ day: days[0], slot: "10:00" });
  const retry = pick ? zonedLocalToUtc(`${pick.day}T${pick.slot}`, zone) : null;
  // Sending the change only makes sense on an open case that isn't already waiting on the carrier.
  const canMarkSent = item.status !== "waiting_on_carrier" && !item.servicingRequestId && item.step !== "lost";
  // Drawn on: reaching the client usually is the change.
  const [markSent, setMarkSent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callLogged, setCallLogged] = useState(false);
  const chosen = OUTCOMES.find((o) => o.key === outcomeKey) ?? null;
  const reached = Boolean(chosen && !isUnreached(chosen.outcome));
  const sending = canMarkSent && reached && markSent;

  async function save() {
    if (!chosen) { setError("Choose what happened on the call."); return; }
    setBusy(true); setError(null);
    let logged = callLogged;
    let kept = true;
    try {
      // A retry after the "sent" mark failed must not log the same call twice.
      if (!logged) {
        const answer = await api<{ nextAttemptSaved?: boolean } | null>("/api/app/retention/cases", { method: "POST", body: {
          action: "call", id: item.id, outcome: chosen.outcome, did: "none", note: note.trim() || null,
          ...(retry ? { next_attempt_at: retry.toISOString(), next_attempt_label: retryLabel(retry, zone, theirs) } : {}),
          ...(chosen.clientCallsCarrier ? { client_calls_carrier: true } : {}),
        } });
        logged = true;
        // The server logs the call even when "try again" couldn't be kept, and says so.
        kept = answer?.nextAttemptSaved !== false;
        setCallLogged(true);
      }
      if (sending) await api("/api/app/retention/cases", { method: "POST", body: { action: "fix", id: item.id, kind: "sent_to_carrier", note: null } });
      onSaved(!kept ? "Logged, but the try-again day wasn’t kept. Set it again." : sending ? "Logged. It waits for the next carrier file." : retry ? `Logged. Try again ${dayLabel(dayKey(retry, zone))}.` : "Attempt logged");
    } catch (e) {
      const words = e instanceof ApiError ? e.message : "That wasn’t saved. Try again.";
      // The call is on the case already; only the "sent" mark failed, so say that rather than ask for it twice.
      setError(logged ? `The call is logged, but the change wasn’t marked sent: ${words}` : words);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Log an attempt" onClose={onClose} testID="log-attempt">
      <View style={{ gap: 14 }}>
        <ChoiceTiles testID="attempt" items={OUTCOMES} value={outcomeKey} onPick={(k) => { setOutcomeKey(k); setError(null); }} disabled={busy} />
        <SheetField testID="attempt-note" label="What changed" value={note} onChangeText={setNote} multiline maxLength={2000} />
        <SelectField testID="attempt-retry" label="Try again" trail="calendar" value={retry ? retryLabel(retry, zone, theirs) : null} placeholder="Pick a day and time"
          onPress={() => setPicking((open) => !open)} disabled={busy} />
        {picking ? (
          <View style={{ gap: 10 }}>
            <WeekStrip padded={false} days={days.map((k) => ({ key: k, label: weekday(k), num: dayOfMonth(k) }))} value={day} onPick={(k) => setDay(k)} />
            <Mini>{theirs ? "Their time" : "Your time"}</Mini>
            <SlotGrid value={pick?.day === day ? pick.slot : null}
              slots={SLOTS.map(([key, label]) => ({ key, label }))}
              onPick={(k) => { setPick({ day, slot: k }); setPicking(false); }} />
          </View>
        ) : null}
        {canMarkSent && reached ? (
          <Between>
            <Text style={{ flex: 1, fontFamily: F.r, fontSize: 15, color: p.ink }}>Mark “Send the change” as done</Text>
            <Toggle label="Mark “Send the change” as done" value={markSent} onChange={setMarkSent} disabled={busy} />
          </Between>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 14, color: p.bad }}>{error}</Text> : null}
        <Button write testID="attempt-save" label="Save attempt" onPress={() => void save()} busy={busy} disabled={!chosen} />
      </View>
    </Sheet>
  );
}
