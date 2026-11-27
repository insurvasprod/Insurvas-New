import { useState } from "react";
import { Text, View } from "react-native";

import { Mini, SlotGrid, WeekStrip } from "./parts";
import { addDays, clock, dayKey, dayLabel, dayOfMonth, deviceZone, stateName, weekday, zoneLong, zonedLocalToUtc } from "./time";
import { Button, F, Toggle } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C9 · Schedule a callback. The day and time are picked in the customer's zone and shown in
 * yours underneath. The server checks the calling window when it is saved and answers in its own
 * words; the phone only offers times that have not passed.
 */
const SLOTS = [["09:00", "9:00 am"], ["10:00", "10:00 am"], ["11:30", "11:30 am"], ["13:00", "1:00 pm"], ["14:30", "2:30 pm"], ["16:00", "4:00 pm"]] as const;

export function CallbackPicker({ zone, state, busy, onSave, onChange, saveLabel = "Save callback", agentZone, teamOption = false, remindOption = false }: {
  zone: string; state?: string | null; busy?: boolean;
  /** Told when the day or time changes, so a refusal about the old time can be cleared. */
  onChange?: () => void;
  /**
   * `local` is the wall clock in the customer's zone ("2026-11-25T13:00"); `team` is the board's "Anyone
   * on the team can take it"; `remind` is "Remind me 5 minutes before" (a reminder on this phone).
   */
  onSave: (local: string, options: { team: boolean; remind: boolean }) => void;
  saveLabel?: string; agentZone?: string | null;
  /** Offer "Anyone on the team can take it" (PATCH /api/app/callbacks hand_over → queue after the save). */
  teamOption?: boolean;
  /** Offer "Remind me 5 minutes before" (on by default); the caller sets it with `remindBefore` (./reminder). */
  remindOption?: boolean;
}) {
  const p = usePalette();
  // Read once when the picker opens, so the render stays pure.
  const [now] = useState(() => Date.now());
  const today = dayKey(new Date(now), zone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [day, setDay] = useState(days[1]);
  const [slot, setSlot] = useState<string | null>(null);
  const [team, setTeam] = useState(false);
  const [remind, setRemind] = useState(true);
  const mine = agentZone || deviceZone();
  const local = slot ? `${day}T${slot}` : null;
  const at = local ? zonedLocalToUtc(local, zone) : null;
  const where = [stateName(state), `(${zoneLong(zone)})`].filter(Boolean).join(" ");

  return (
    <View style={{ gap: 14 }}>
      <WeekStrip padded={false} days={days.map((k) => ({ key: k, label: weekday(k), num: dayOfMonth(k) }))} value={day} onPick={(k) => { setDay(k); setSlot(null); onChange?.(); }} />
      <Mini>{`Their time · ${where}`}</Mini>
      <SlotGrid value={slot} onPick={(k) => { setSlot(k); onChange?.(); }} slots={SLOTS.map(([key, label]) => ({ key, label, disabled: zonedLocalToUtc(`${day}T${key}`, zone).getTime() <= now }))} />
      {at ? (
        <View style={{ backgroundColor: p.surf2, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>{`${dayLabel(day)}, ${clock(at, zone)} their time`}</Text>
          <Mini style={{ marginTop: 2 }}>{`${dayKey(at, mine) === day ? "" : `${dayLabel(dayKey(at, mine))}, `}${clock(at, mine)} your time (${zoneLong(mine)})`}</Mini>
        </View>
      ) : null}
      {remindOption ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: F.r, fontSize: 16, color: p.ink }}>Remind me 5 minutes before</Text>
          <Toggle label="Remind me 5 minutes before" value={remind} onChange={setRemind} />
        </View>
      ) : null}
      {teamOption ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: F.r, fontSize: 16, color: p.ink }}>Anyone on the team can take it</Text>
          <Toggle label="Anyone on the team can take it" value={team} onChange={setTeam} />
        </View>
      ) : null}
      <Button write testID="callback-save" label={saveLabel} onPress={() => { if (local) onSave(local, { team, remind: remindOption && remind }); }} disabled={!local} busy={busy} />
    </View>
  );
}
