import { useState } from "react";
import { Text, View } from "react-native";

import { CallbackPicker } from "@/components/calls/callback-picker";
import { SheetModal } from "@/components/calls/parts";
import { afterBooking } from "@/components/calls/reminder";
import { clock, dayKey, dayLabel, zonedLocalToUtc, zoneLong, zoneShort } from "@/components/calls/time";
import { PickerSheet } from "@/components/leads/parts";
import { SelectField } from "@/components/leads/sheets";
import { F, Loading } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/** GET /api/app/callbacks?lead_id=… (the Callbacks page's Add callback): what booking one needs. */
type BookingFacts = {
  lead: { leadId: string; customerName: string; state: string | null; timezone: string | null; timezoneProblem: string | null; open: { id: string; scheduledAtUtc: string; customerTimezone: string } | null };
  timezones: string[];
};

/**
 * The lead page's Schedule (board D3's outline button): the Calls area's callback picker (C9) for
 * this lead, booked through POST /api/app/callbacks, the web Callbacks page's own Add callback. The
 * time is picked in the customer's zone; a split or unknown state asks for the zone first, as the
 * web does, and the server checks the calling window when it is saved, answering in its own words.
 * A lead has one open callback at a time, so a booking for a lead that has one moves it.
 */
export function ScheduleSheet({ visible, leadId, firstName, onClose, onBooked }: { visible: boolean; leadId: string; firstName: string; onClose: () => void; onBooked: (message: string) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const facts = useLoad(() => (visible ? api<BookingFacts>(`/api/app/callbacks?lead_id=${leadId}`) : Promise.resolve(null)), [visible, leadId]);
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const [pickingZone, setPickingZone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lead = facts.data?.lead ?? null;
  const zone = lead?.timezone ?? chosenZone;

  function close() { setError(null); setChosenZone(null); onClose(); }

  async function book(local: string, options: { team: boolean; remind: boolean }) {
    if (!zone) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<{ result?: { callback_id?: string } }>("/api/app/callbacks", { method: "POST", body: { lead_id: leadId, callback_local: local, ...(lead?.timezone ? {} : { timezone: zone }), idempotency_key: `app-callback-${leadId}-${Date.now()}` } });
      const at = zonedLocalToUtc(local, zone);
      // C9's two switches, as Schedule a callback (calls/schedule-callback.tsx) does after the booking.
      const missed = await afterBooking(api, { leadId, callbackId: answer?.result?.callback_id ?? null, ...options, at, customerName: lead?.customerName ?? firstName ?? "Callback", theirTime: `${clock(at, zone)} their time (${zoneShort(zone, at)})` });
      onBooked([`Callback set for ${dayLabel(local.slice(0, 10))}, ${clock(at, zone)} their time`, ...missed].join(" · "));
      setChosenZone(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The callback was not saved.");
    } finally {
      setBusy(false);
    }
  }

  const open = lead?.open ?? null;
  return (
    <SheetModal visible={visible} title={`Call ${firstName || "them"} back`} onClose={close}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        {facts.loading && !facts.data ? <Loading rows={2} /> : facts.error && !facts.data ? (
          <Text style={{ fontFamily: F.r, fontSize: 15, color: p.bad }}>{facts.error}</Text>
        ) : lead ? (
          <>
            {open ? (
              <Text style={{ fontFamily: F.r, fontSize: 13.5, lineHeight: 19, color: p.muted }}>
                {`${firstName || "This lead"} already has a callback ${dayLabel(dayKey(new Date(open.scheduledAtUtc), open.customerTimezone))}, ${clock(new Date(open.scheduledAtUtc), open.customerTimezone)} their time. A new time moves it.`}
              </Text>
            ) : null}
            {!lead.timezone ? (
              <SelectField testID="schedule-zone" label="Their time zone" value={chosenZone ? zoneLong(chosenZone) : null} placeholder={lead.timezoneProblem ?? "Choose their time zone"} onPress={() => setPickingZone(true)} />
            ) : null}
            {zone ? <CallbackPicker key={zone} zone={zone} state={lead.state} busy={busy} onChange={() => setError(null)} teamOption remindOption onSave={(local, o) => void book(local, o)} /> : null}
            {error ? <Text testID="schedule-error" style={{ fontFamily: F.r, fontSize: 14, color: p.bad }}>{error}</Text> : null}
          </>
        ) : null}
      </View>
      <PickerSheet title="Their time zone" visible={pickingZone} onClose={() => setPickingZone(false)} value={chosenZone} onPick={setChosenZone}
        items={(facts.data?.timezones ?? []).map((z) => ({ key: z, label: zoneLong(z), meta: z }))} />
    </SheetModal>
  );
}
