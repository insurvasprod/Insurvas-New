import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { CallbackPicker } from "@/components/calls/callback-picker";
import { Mini, SheetModal, Snack } from "@/components/calls/parts";
import { afterBooking } from "@/components/calls/reminder";
import { clock, deviceZone, zoneLong, zonedLocalToUtc, zoneShort } from "@/components/calls/time";
import { Icon } from "@/components/icon";
import { Button, Card, Empty, F, Failed, Field, Loading, Screen, T } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { answerLabel, CALLBACK_KEY, callerName, consequences, quickTimes } from "./model";
import { ChoiceChip, H4, RadioCard } from "./parts";
import type { Wizard } from "./types";

/**
 * Board C6 · Finish the call (web step 4, ?phase=finish): the agency's disposition tree one question at a
 * time, the walked answers editable, the consequence shown right above the commit.
 *
 *   POST /api/app/inbound/disposition { action: "start" }     opens (or resumes) the walk — a write, so never a GET
 *   POST … { action: "answer", walk_id, node_id, sequence }   each answer; the server answers with the walk
 *   POST … { action: "complete", disposition_key, callback_* } the outcome; an application outcome is refused
 *                                                             until verification is complete (the server's gate)
 *
 * Saved, it opens Daily deal flow straight away, as the web does (the screen's onSaved); the board draws no toast.
 */
/** The zones a US caller can be in, east to west (a subset of the server's US_CUSTOMER_TIMEZONES). */
const CALLER_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function FinishCall({ workItemId, header, canFinish, preset, onSaved }: { workItemId: string; header: ReactNode; canFinish: boolean; preset?: string | null; onSaved: () => void }) {
  const p = usePalette();
  const { api } = useSession();
  const started = useLoad(() => (canFinish ? api<Wizard>("/api/app/inbound/disposition", { method: "POST", body: { action: "start", work_item_id: workItemId } }) : Promise.resolve(null)), [workItemId, canFinish]);
  const [walked, setWalked] = useState<Wizard | null>(null);
  const wizard = walked ?? started.data;
  const [editing, setEditing] = useState<number | null>(null);
  const [option, setOption] = useState<string | null>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [free, setFree] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [callbackLocal, setCallbackLocal] = useState<string | null>(null);
  // A caller whose zone the record doesn't settle (a state that spans two, or none on file): the agent asks them
  // and picks it here, as the web's Add callback does; it goes with the outcome as callback_timezone.
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // C9's two switches from Pick… (board defaults: remind on, team off); the quick times keep the defaults.
  const [saidAfter, setSaidAfter] = useState<string | null>(null);
  const [switches, setSwitches] = useState({ team: false, remind: true });
  // One key per outcome, kept across retries: a retry after a lost answer finds the callback it booked.
  const [idempotencyKey] = useState(() => `app:${workItemId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  const [now] = useState(() => Date.now());

  if (!canFinish) {
    return <Screen header={header}><Empty icon="userPlus" title="A licensed agent finishes the call" body="Hand the call to one from Verification." /></Screen>;
  }
  if (!wizard) {
    return <Screen header={header}>{started.error ? <Failed message={started.error} onRetry={started.reload} /> : <Loading rows={4} />}</Screen>;
  }

  const nodes = new Map(wizard.flow.nodes.map((n) => [n.id, n]));
  const steps = [...wizard.steps].sort((a, b) => a.sequence - b.sequence);
  const node = editing !== null ? nodes.get(steps.find((s) => s.sequence === editing)?.node_id ?? "") ?? null : wizard.currentNode;
  const sequence = editing ?? wizard.steps.length;
  const picked = node?.node_type === "choice" ? node.options.find((o) => o.option_key === option) ?? null : null;
  // The outcome: named by the chosen answer (an outcome question), or chosen below once the walk is done.
  // L2's Callback opens here with the callback outcome asked for: chosen once the walk reaches the outcomes.
  const presetKey = preset && wizard.outcomeOptions?.some((o) => o.disposition_key === preset) ? preset : null;
  const key = picked?.disposition_key ?? (node ? null : outcome ?? wizard.walk.final_disposition_key ?? presetKey);
  const chosen = wizard.outcomeOptions?.find((o) => o.disposition_key === key) ?? null;
  const isCallback = key === CALLBACK_KEY;
  const known = wizard.customerTimezone;
  const zone = known ?? zoneChoice;
  const mine = deviceZone();
  const callbackAt = isCallback && zone && callbackLocal ? zonedLocalToUtc(callbackLocal, zone) : null;
  const effects = consequences(chosen, callbackAt && zone ? { at: callbackAt, zone, mine } : null, wizard.callbackReminderMinutes);
  const quick = zone ? quickTimes(zone, now) : [];

  async function post<T>(body: Record<string, unknown>): Promise<T | null> {
    setBusy(true); setError(null);
    try {
      return await api<T>("/api/app/inbound/disposition", { method: "POST", body: { work_item_id: workItemId, walk_id: wizard?.walk.id, ...body } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved. Check your signal and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function answer(): Promise<boolean> {
    if (!node) return true;
    const payload: Record<string, unknown> = { action: "answer", node_id: node.id, sequence };
    if (node.node_type === "choice") payload.option_key = option;
    else payload.answer = node.node_type === "multi_select" ? multi : free.trim();
    const res = await post<{ wizard: Wizard }>(payload);
    if (!res) return false;
    setWalked(res.wizard);
    setEditing(null); setOption(null); setMulti([]); setFree("");
    return true;
  }

  async function complete() {
    if (!key) return;
    // An outcome question: its answer is saved to the walk first, then the outcome it names is recorded.
    if (node && !(await answer())) return;
    const res = await post<{ result: { label?: string } }>({
      action: "complete", disposition_key: key,
      ...(isCallback ? { callback_local: callbackLocal ?? undefined, callback_idempotency_key: idempotencyKey, ...(!known && zoneChoice ? { callback_timezone: zoneChoice } : {}) } : {}),
    });
    if (!res) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setSaved(res.result?.label ?? chosen?.label ?? "Outcome saved");
    const missed = isCallback && callbackAt && zone
      ? await afterBooking(api, { leadId: wizard?.lead.id ?? "", ...switches, at: callbackAt, customerName: wizard ? callerName(wizard.lead.values) : "Callback", theirTime: `${clock(callbackAt, zone)} their time (${zoneShort(zone, callbackAt)})` })
      : [];
    // Board C6: saving opens Daily deal flow straight away. Only a switch that didn't take is said first.
    if (!missed.length) { onSaved(); return; }
    setSaidAfter(missed.join(" · "));
    setTimeout(onSaved, 2500);
  }

  function edit(seq: number) {
    const step = steps.find((s) => s.sequence === seq);
    const n = step ? nodes.get(step.node_id) : undefined;
    if (!step || !n) return;
    setEditing(seq); setError(null);
    setOption(step.option_key);
    setMulti(Array.isArray(step.answer) ? step.answer.map(String) : []);
    setFree(typeof step.answer === "string" ? step.answer : "");
  }

  const ready = node
    ? (node.node_type === "choice" ? Boolean(option) : node.node_type === "multi_select" ? multi.length > 0 : free.trim().length > 0)
    : Boolean(key);
  const needsTime = isCallback && !callbackLocal;
  const recording = Boolean(key);
  const footer = (
    <Button write testID="finish-save" label={recording ? "Save outcome" : editing !== null ? "Save answer" : "Next"} busy={busy}
      disabled={!ready || (recording && (needsTime || (isCallback && !zone))) || Boolean(saved)}
      onPress={() => void (recording ? complete() : answer())} />
  );

  return (
    <View style={{ flex: 1 }}>
    <Screen header={header} footer={footer}>
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        {steps.length ? (
          <Card>
            <Mini>Your answers</Mini>
            <View style={{ gap: 8, marginTop: 8 }}>
              {steps.map((s, i) => (
                <View key={s.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 14, color: p.muted }}>{i + 1}</Text>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.r, fontSize: 14, color: p.muted }}>{nodes.get(s.node_id)?.prompt || s.node_label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0, maxWidth: "50%" }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.m, fontSize: 14, color: p.ink }}>{answerLabel(s, nodes.get(s.node_id))}</Text>
                    <Pressable testID={`finish-edit-${s.sequence}`} accessibilityRole="button" accessibilityLabel={`Edit the answer to ${s.node_label}`} hitSlop={8} disabled={busy || Boolean(saved)} onPress={() => edit(s.sequence)}>
                      <Text style={{ fontFamily: F.s, fontSize: 13, color: p.greenInk }}>Edit</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {node ? (
          <View>
            <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 24, lineHeight: 29, letterSpacing: -0.48, color: p.ink, marginTop: 6, marginBottom: 12 }}>{node.prompt || node.label}</Text>
            {node.node_type === "free_text" ? (
              <Field testID="finish-free" label="Answer" value={free} onChangeText={setFree} multiline />
            ) : (
              <View style={{ gap: 8 }}>
                {[...node.options].sort((a, b) => a.sort_order - b.sort_order).map((o) => (
                  <RadioCard key={o.option_key} testID={`finish-option-${o.option_key}`} label={o.label} square={node.node_type === "multi_select"}
                    on={node.node_type === "multi_select" ? multi.includes(o.option_key) : option === o.option_key} disabled={busy || Boolean(saved)}
                    onPress={() => (node.node_type === "multi_select" ? setMulti((xs) => (xs.includes(o.option_key) ? xs.filter((x) => x !== o.option_key) : [...xs, o.option_key])) : setOption(o.option_key))} />
                ))}
              </View>
            )}
          </View>
        ) : wizard.outcomeOptions === null ? (
          <T kind="small">The outcomes could not be read. Try again in a moment.</T>
        ) : (
          <View>
            <Text accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 24, lineHeight: 29, letterSpacing: -0.48, color: p.ink, marginTop: 6, marginBottom: 12 }}>How did the call end?</Text>
            <View style={{ gap: 8 }}>
              {wizard.outcomeOptions.map((o) => (
                <RadioCard key={o.disposition_key} testID={`finish-outcome-${o.disposition_key}`} label={o.label} on={key === o.disposition_key} disabled={busy || Boolean(saved)} onPress={() => setOutcome(o.disposition_key)} />
              ))}
            </View>
          </View>
        )}

        {isCallback ? (
          <Card>
            <H4>When should we call back?</H4>
            {!known ? (
              <>
                <Mini style={{ marginTop: 2 }}>Ask which time zone they’re in.</Mini>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                  {CALLER_ZONES.map((z) => <ChoiceChip key={z} testID={`finish-zone-${z}`} label={zoneLong(z)} on={zoneChoice === z} onPress={() => { setZoneChoice(z); setCallbackLocal(null); }} />)}
                </ScrollView>
              </>
            ) : null}
            {zone ? (
              <>
                {known ? <Mini style={{ marginTop: 2 }}>{`In their time: ${zoneLong(zone)}`}</Mini> : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                  {quick.map((q) => <ChoiceChip key={q.local} testID={`finish-time-${q.local}`} label={q.label} on={callbackLocal === q.local} onPress={() => setCallbackLocal(q.local)} />)}
                  <ChoiceChip testID="finish-time-pick" label={callbackLocal && !quick.some((q) => q.local === callbackLocal) ? "Picked" : "Pick…"} icon="calendar" on={Boolean(callbackLocal) && !quick.some((q) => q.local === callbackLocal)} onPress={() => setPicking(true)} />
                </ScrollView>
              </>
            ) : null}
          </Card>
        ) : null}

        {effects.length ? (
          <View style={{ backgroundColor: p.surf2, borderWidth: 1, borderColor: p.line, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 }}>
            <H4>What happens when you save</H4>
            <View style={{ gap: 6, marginTop: 8 }}>
              {effects.map((e) => (
                <View key={e.icon + e.text} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Icon name={e.icon} size={18} color={p.body} />
                  <Text style={{ flex: 1, fontFamily: F.r, fontSize: 15, color: p.body }}>{e.text}{e.bold ? <Text style={{ fontFamily: F.b, color: p.ink }}>{` ${e.bold}`}</Text> : null}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <T color={p.bad}>{error}</T> : null}
      </View>

      {picking && zone ? (
        <SheetModal visible title="Call them back" onClose={() => setPicking(false)}>
          <CallbackPicker zone={zone} state={typeof wizard.lead.values.state === "string" ? wizard.lead.values.state : null} saveLabel="Use this time" teamOption remindOption
            onSave={(local, o) => { setCallbackLocal(local); setSwitches(o); setPicking(false); }} />
        </SheetModal>
      ) : null}
    </Screen>
    {saved && saidAfter ? <Snack text={`Outcome saved · ${saved} · ${saidAfter}`} bottom={96} /> : null}
    </View>
  );
}
