import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useReducedMotion } from "react-native-reanimated";

import { Icon } from "./icon";
import { Button, Card, Chip, F, Header, IOS, Row, T, type HeaderAction } from "./ui";
import { CallbackPicker } from "./calls/callback-picker";
import { Bar, DialogLayer, Dim, Mini, OutcomeTiles, SheetPanel, Snack } from "./calls/parts";
import { remindBefore } from "./calls/reminder";
import { clock, dayKey, dayLabel, deviceZone, stateName, zonedLocalToUtc, zoneShort } from "./calls/time";
import { BookAppointment } from "./calendar/book-appointment";
import { complianceChecks, type ClientCheck, type Consent, type Eligibility } from "./dialer/checks";
import { ChecksList } from "./dialer/checks-sheet";
import { ScriptScreen, type Rebuttal, type ScriptSource } from "./dialer/script-screen";
import { showDialCall, syncOngoingNotification } from "@/components/native/ongoing-call";
import { ApiError } from "@/lib/api";
import { isQueued } from "@/lib/outbox";
import { firstName, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";
import { ModalCover } from "@/components/states/privacy-cover";

/**
 * Board C7c / C8 / C9 / C10: a call, the web dialer's way, on the phone's own dialer.
 *
 *   1  the dialer panel (script, disclosure, outcomes) for this lead
 *   2  the disclosure on screen, word for word, beside the Call button. As on the web dialer (owner rule
 *      2026-10-27: "the state's wording is on screen beside the Call button, so the click is the agent's
 *      acknowledgement"), Call records the disclosure on the attempt: POST attempt, POST
 *      attempt/:id/disclosure (the record the server requires before a click), then POST
 *      attempt/:id/click, where the server re-runs suppression, DNC, litigators, the calling window and
 *      consent right before the handoff, and refuses there (C10)
 *   3  only then the phone's own dialer opens (never a bare tel: link anywhere else in the app)
 *   4  C7c on the call: back in the app while the call runs, the same words in big type with the call's
 *      time since it was placed ("On the call 0:04"), "I read it", and "… didn't answer · voicemail".
 *      The phone has no way to know the moment the customer answers (no phone provider), so the timer
 *      runs from the dial; the time "I read it" was tapped is the phone's own ("Read at 0:09" on C8)
 *   5  C8: the outcome; C9: a callback in the customer's own time
 *
 * Over the outcome: C7b the checks the server ran for this number, C7d the script and rebuttals, and
 * C8b booking an appointment, each read from the panel (or its own route), never a second rule.
 */
type Panel = {
  lead: { id: string; fullName: string; state: string | null; phone: string | null; productCode: string | null; city?: string | null; attemptsMade?: number; attemptCeiling?: number | null; workItemId?: string | null };
  script: { id: string | null; version: number; productCode: string | null; campaignId?: string | null; sections?: Record<string, unknown> };
  /** The script as written and who published it (2026-11-26, additive); null for the built-in default. */
  scriptSource?: ScriptSource | null;
  rebuttals?: Rebuttal[];
  eligibility?: Eligibility | null;
  consent?: Consent | null;
  client?: ClientCheck | null;
  /** The agent's own zone (their working hours); null means the phone's. */
  viewerTimezone?: string | null;
  /** `version`: the wording's place among this state and product's versions (2026-11-26, additive). */
  disclosure: { state: string | null; productCode: string | null; requiredText: string; configured: boolean; blocking: boolean; approved: boolean; version?: number | null };
  /** The agency's outcome buttons (one vocabulary, in order), wrapped with where they came from. */
  outcomes: { source: string; outcomes: { key: string; label: string; position: number }[] };
  window: { allowed: boolean; startMinute?: number | null; endMinute?: number | null; zone: string | null; reason: string | null } | null;
};
type Step = "loading" | "disclosure" | "oncall" | "outcome" | "callback" | "done" | "refused";
/** What sits over the current step: the ... menu, C7b checks, C7d script, C8b booking. */
type Over = "menu" | "checks" | "script" | "book" | null;

const CALLBACK = /callback/i;
const APPOINTMENT = /appointment|booked/i;
const VOICEMAIL = /voice[_ ]?mail|left[_ ]?message/i;
const INTERESTED = /^(?!.*not[_ ]?interested).*interested/i;

/** "6:42": how long the phone was away in its dialer, from the tap to the return. */
export function callLength(from: Date, to: Date): string {
  const s = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Board C8: the agency's outcomes in their order, except that Interested leads (and spans the row). */
export function outcomeOrder<T extends { key: string; label: string; position: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((o) => INTERESTED.test(o.key) || INTERESTED.test(o.label));
  return i > 0 ? [sorted[i], ...sorted.slice(0, i), ...sorted.slice(i + 1)] : sorted;
}

/** Board C7c's line under the words: "Texas · outbound disclosure v4 · 31 words". */
export function disclosureLine(state: string | null, version: number | null | undefined, words: number): string {
  return [stateName(state), version ? `outbound disclosure v${version}` : "outbound disclosure", `${words} words`].filter(Boolean).join(" · ");
}

export function CallSheet({ leadId, visible, onClose, onSaved, backLabel = "Back", onSkip, onNext }: {
  leadId: string; visible: boolean; onClose: () => void; onSaved: () => void;
  /** The screen the back arrow returns to ("Dialer" from Calls). */
  backLabel?: string;
  /** From the dialer list: a refusal offers "Skip to the next lead". */
  onSkip?: () => void;
  /** From the dialer list: saving an outcome serves the next lead. */
  onNext?: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [step, setStep] = useState<Step>("loading");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [dialedAt, setDialedAt] = useState<Date | null>(null);
  const [readAt, setReadAt] = useState<Date | null>(null);
  const [endedAt, setEndedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [over, setOver] = useState<Over>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [saidAfter, setSaidAfter] = useState<string | null>(null);
  // Board L4: the outcome was given with no signal and waits on the phone (lib/outbox.ts), so it is not "saved".
  const [queued, setQueued] = useState(false);
  const reduced = useReducedMotion();
  const stepRef = useRef<Step>("loading");
  useEffect(() => { stepRef.current = step; }, [step]);

  // Mounted only while open (the lead page renders it on Call), so every call starts from a clean sheet.
  useEffect(() => {
    api<Panel>(`/api/app/dialer/panel?lead_id=${leadId}`)
      .then((pn) => {
        setPanel(pn);
        // When the server's own eligibility read already says no (licence lapsed, window closed, number
        // listed), the click would be refused too, so say it now, before the disclosure is read to anyone.
        // In the server's words when it gave some, else the failing check's.
        const failing = complianceChecks(pn, new Date(), pn.viewerTimezone || deviceZone()).find((c) => c.state === "bad" && c.key !== "client");
        const refusedNow = pn.eligibility?.allowed === false
          ? pn.eligibility.message || (failing?.detail?.endsWith(".") ? failing.detail : failing ? `${failing.title}: ${failing.detail ?? "refused"}.` : "This number can’t be called right now.")
          : null;
        if (pn.disclosure.blocking) { setMessage(pn.disclosure.requiredText); setStep("refused"); }
        else if (!pn.lead.phone) { setMessage("This lead has no phone number."); setStep("refused"); }
        else if (refusedNow) { setMessage(refusedNow); setStep("refused"); }
        else setStep("disclosure");
      })
      .catch((e) => { setMessage(e instanceof ApiError ? e.message : "Couldn’t open the dialer for this lead."); setStep("refused"); });
  }, [leadId, api]);

  // Back from the phone's dialer. On the call (C7c) the screen stays and its timer runs; once on the
  // outcome, each return moves the call's end to that moment (the last time the phone came back).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      setNow(Date.now());
      if (stepRef.current === "outcome" || stepRef.current === "callback") setEndedAt(new Date());
    });
    return () => sub.remove();
  }, []);

  // "On the call 0:04": the clock ticks while the call screen is up.
  useEffect(() => {
    if (step !== "oncall") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const dial = useCallback(async () => {
    if (!panel?.lead.phone) return;
    setBusy(true); setMessage(null);
    let started: { attempt: { id: string } } | null = null;
    const startAttempt = () => api<{ attempt: { id: string } }>("/api/app/dialer/attempt", { method: "POST", body: {
      lead_id: leadId, script_id: panel.script.id, script_version: panel.script.version || null,
      disclosure_state: panel.disclosure.state ?? panel.lead.state ?? "", disclosure_product_code: panel.disclosure.productCode ?? panel.script.productCode ?? panel.lead.productCode ?? "",
    } });
    try {
      try {
        started = await startAttempt();
      } catch (e) {
        // Opened from a lead, a callback or the calendar rather than served by the queue: the lead isn't
        // claimed yet. Claim it the way the web's "Call now" does (POST /api/app/dialer/pick with the
        // lead, every serve gate first, the lead locked to this agent), then start the attempt again.
        if (!(e instanceof ApiError) || e.status !== 409 || !/^Claim this lead/.test(e.message)) throw e;
        const picked = await api<{ served: unknown; error?: string }>("/api/app/dialer/pick", { method: "POST", body: { lead_id: leadId } });
        if (!picked.served) throw new ApiError(409, { error: picked.error ?? "This lead can’t be called right now." });
        started = await startAttempt();
      }
      setAttemptId(started.attempt.id);
      // The words are on screen beside Call, so the tap is the acknowledgement recorded on the attempt
      // (the web dialer's one-click call does the same); the server refuses a click without it.
      await api(`/api/app/dialer/attempt/${started.attempt.id}/disclosure`, { method: "POST", body: {
        state: panel.disclosure.state ?? panel.lead.state ?? "", product_code: panel.disclosure.productCode ?? panel.script.productCode ?? panel.lead.productCode ?? "",
      } });
      await api(`/api/app/dialer/attempt/${started.attempt.id}/click`, { method: "POST" });
      // Board L2: the ongoing-call notification goes up at the dial, before the phone's dialer takes over.
      void showDialCall({ attemptId: started.attempt.id, leadId, customer: panel.lead.fullName, state: panel.disclosure.state ?? panel.lead.state, productCode: panel.disclosure.productCode ?? panel.lead.productCode, attemptNumber: (started.attempt as { attempt_number?: number }).attempt_number ?? null });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      const at = new Date();
      setDialedAt(at);
      setNow(at.getTime());
      setStep("oncall");
      await Linking.openURL(`tel:${panel.lead.phone.replace(/[^\d+]/g, "")}`);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      setMessage(e instanceof ApiError ? e.message : "The call could not be started.");
      // Refused at the click: the attempt exists, so its outcome is still recorded (e.g. "not called").
      setStep(started ? "outcome" : "refused");
    } finally {
      setBusy(false);
    }
  }, [api, leadId, panel]);

  const save = useCallback(async (key: string, callbackLocal?: string, options?: { team: boolean; remind: boolean }) => {
    if (!attemptId) { onClose(); return; }
    setBusy(true); setMessage(null);
    try {
      const zone = panel?.window?.zone ?? null;
      const words = note.trim();
      const answer = await api<unknown>(`/api/app/dialer/attempt/${attemptId}/disposition`, { method: "POST", body: callbackLocal ? { disposition: key, callback_local: callbackLocal, customer_timezone: zone, ...(words ? { callback_note: words } : {}) } : { disposition: key } });
      if (isQueued(answer)) {
        // No signal: the outcome (and the note, which queues too) waits on the phone. No hand-over, no reminder, no
        // success buzz and no next lead (serving one needs the server); the board's L4 line says what happened.
        if (words) await api(`/api/app/leads/${leadId}/notes`, { method: "POST", body: { body: words, idempotency_key: `call-${attemptId}` } }).catch(() => undefined);
        setQueued(true);
        setChosen(key);
        setStep("done");
        onSaved();
        setTimeout(onClose, 1500);
        return;
      }
      // Board L2: the outcome is saved, so the ongoing-call notification comes down.
      void syncOngoingNotification(null);
      // C8 "Note for the next agent": a note on the lead (POST /api/app/leads/:id/notes), as on the web lead.
      if (words) await api(`/api/app/leads/${leadId}/notes`, { method: "POST", body: { body: words, idempotency_key: `call-${attemptId}` } }).catch(() => undefined);
      // C9 after the booking: "Anyone on the team can take it" hands the lead's open callback to the
      // queue (the web Callbacks page's own action), and "Remind me 5 minutes before" sets this phone's.
      const after: string[] = [];
      if (callbackLocal && options?.team) {
        const handed = await api<{ lead: { open: { id: string } | null } }>(`/api/app/callbacks?lead_id=${leadId}`)
          .then((f) => (f.lead.open ? api("/api/app/callbacks", { method: "PATCH", body: { action: "hand_over", callback_ids: [f.lead.open.id], to: "queue" } }).then(() => true) : false))
          .catch(() => false);
        if (!handed) after.push("not handed to the team");
      }
      if (callbackLocal && options?.remind && zone) {
        const at = zonedLocalToUtc(callbackLocal, zone);
        if (!(await remindBefore(at, panel?.lead.fullName ?? "Callback", `${clock(at, zone)} their time (${zoneShort(zone, at)})`))) after.push("no reminder set");
      }
      setSaidAfter(after.length ? after.join(" · ") : null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setChosen(key);
      setStep("done");
      onSaved();
      setTimeout(() => { onClose(); onNext?.(); }, 700);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "The outcome wasn’t saved. Try again.");
      if (callbackLocal) setStep("outcome");
    } finally {
      setBusy(false);
    }
  }, [api, attemptId, leadId, note, onClose, onNext, onSaved, panel]);

  /** C8 "Start application" (the web dialer's): POST /api/app/outbound/application, then the lead. */
  const startApplication = useCallback(async () => {
    const workItemId = panel?.lead.workItemId;
    if (!workItemId) return;
    setStarting(true); setMessage(null);
    try {
      await api("/api/app/outbound/application", { method: "POST", body: { work_item_id: workItemId, ...(panel?.lead.productCode ? { product_line: panel.lead.productCode } : {}) } });
      onClose();
      router.push(`/lead/${leadId}` as never);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "The application wasn’t started. Try again.");
    } finally {
      setStarting(false);
    }
  }, [api, leadId, onClose, panel]);

  const zone = panel?.window?.zone ?? null;
  const outcomes = outcomeOrder(panel?.outcomes?.outcomes ?? []);
  const callbackKey = outcomes.find((o) => CALLBACK.test(o.key))?.key ?? null;
  const voicemailKey = outcomes.find((o) => VOICEMAIL.test(o.key) || VOICEMAIL.test(o.label))?.key ?? null;
  const chosenLabel = outcomes.find((o) => o.key === chosen)?.label ?? null;
  const name = panel?.lead.fullName ?? "Call";
  const words = panel ? panel.disclosure.requiredText.trim().split(/\s+/).filter(Boolean).length : 0;
  const showOutcome = (step === "outcome" || step === "callback" || step === "done") && panel;
  const phone = phoneLabel(panel?.lead.phone) ?? panel?.lead.phone ?? null;

  const viewerZone = panel?.viewerTimezone || deviceZone();
  const customerZone = zone ?? panel?.eligibility?.timezone ?? null;
  // Board C8: one more-button in the bar; checks (C7b), the script (C7d) and booking (C8b) sit behind it. The script
  // and the checks are there from the disclosure on (C7d is read on the call), not only once the outcome is up.
  const actions: HeaderAction[] = panel && step !== "loading" && step !== "refused" ? [
    { icon: "moreH", label: "More", onPress: () => setOver("menu") },
  ] : [];
  const reading = (step === "disclosure" || step === "oncall") && panel;
  const header = (
    <Header title={name} back={backLabel} onBack={onClose} large={false} actions={actions}
      belowFull={reading ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Mini>Read before anything else</Mini>
          {step === "oncall" && dialedAt ? (
            <View testID="call-timer" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="phone" size={14} color={p.greenInk} />
              <Text style={{ fontFamily: F.s, fontSize: 13, color: p.greenInk, fontVariant: ["tabular-nums"] }}>{`On the call ${callLength(dialedAt, new Date(Math.max(now, dialedAt.getTime())))}`}</Text>
            </View>
          ) : !panel.disclosure.approved ? <Chip tone="warn">Placeholder wording</Chip> : null}
        </View>
      ) : undefined} />
  );

  // C8's disclosure chip: when "I read it" was tapped on the call; "Not reached" when nobody answered.
  const readChip = readAt && dialedAt
    ? <Chip tone={panel?.disclosure.approved ? "ok" : "warn"}>{`${panel?.disclosure.approved ? "Read" : "Placeholder read"} at ${callLength(dialedAt, readAt)}`}</Chip>
    : panel?.disclosure.approved ? <Chip>Not reached</Chip> : <Chip tone="warn">Placeholder · not reached</Chip>;

  return (
    <Modal visible={visible} animationType={reduced ? "fade" : "slide"} presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
        {header}

        {step === "loading" ? <View style={{ padding: 16 }}><T kind="small">Checking this lead…</T></View> : null}

        {/* C7c · the disclosure in big type: beside Call before the dial, then on the call with its time. */}
        {reading ? (
          <>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 }}>
              <Text selectable style={{ fontFamily: F.ds, fontSize: 24, lineHeight: 34, letterSpacing: -0.48, color: p.ink }}>{panel.disclosure.requiredText}</Text>
              <Mini style={{ marginTop: 14 }}>{disclosureLine(panel.disclosure.state ?? panel.lead.state, panel.disclosure.version, words)}</Mini>
              {step === "disclosure" && panel.window && !panel.window.allowed ? <Mini color={p.warn} style={{ marginTop: 8 }}>{panel.window.reason ?? "Outside the calling window for this lead."}</Mini> : null}
            </ScrollView>
            <Bar>
              {step === "disclosure" ? (
                <>
                  <Button testID="call-dial" label={phone ? `Call ${phone}` : "Call"} icon="phone" onPress={dial} busy={busy} />
                  <Mini style={{ textAlign: "center" }}>Calling records this disclosure with the call. The server checks the number again first.</Mini>
                </>
              ) : (
                <>
                  <Button testID="call-read" label="I read it" icon="check" onPress={() => { const at = new Date(); setReadAt(at); setEndedAt(at); setStep("outcome"); }} />
                  <Pressable testID="call-voicemail" accessibilityRole="button" accessibilityLabel={`${firstName(name)} didn’t answer · voicemail`} hitSlop={8} style={{ alignSelf: "center", padding: 4 }}
                    onPress={() => { setEndedAt(new Date()); if (voicemailKey) setChosen(voicemailKey); setStep("outcome"); }}>
                    <Text style={{ fontFamily: F.s, fontSize: 15, color: p.greenInk }}>{`${firstName(name)} didn’t answer · voicemail`}</Text>
                  </Pressable>
                </>
              )}
            </Bar>
          </>
        ) : null}

        {/* C8 · back from the call: the outcome tiles, then Save in the bar. */}
        {showOutcome ? (
          <>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 14 }}>
              {dialedAt ? (
                <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Mini>{endedAt ? "Call ended" : "Dialed"}</Mini>
                    <Text style={{ fontFamily: F.db, fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: p.ink, fontVariant: ["tabular-nums"] }}>{endedAt ? callLength(dialedAt, endedAt) : clock(dialedAt, deviceZone())}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Mini>Disclosure</Mini>
                    {readChip}
                  </View>
                </Card>
              ) : null}
              {message ? <T color={p.bad}>{message}</T> : null}
              <View>
                <Text style={{ fontFamily: F.s, fontSize: 17, color: p.ink, marginBottom: 10 }}>What happened?</Text>
                <OutcomeTiles items={outcomes} value={chosen} disabled={busy || step === "done"}
                  onPick={(k) => {
                    setMessage(null);
                    setChosen(k);
                    if (CALLBACK.test(k)) setStep("callback");
                    // An appointment outcome books one (C8b) before it is saved.
                    else if (APPOINTMENT.test(k) || APPOINTMENT.test(outcomes.find((o) => o.key === k)?.label ?? "")) setOver("book");
                  }} />
              </View>
              {step !== "done" ? <NoteField value={note} onChange={setNote} /> : null}
            </ScrollView>
            <Bar>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {panel.lead.workItemId && step !== "done" ? (
                  <Button write testID="call-start-application" kind="outline" label="Start application" icon="filePen" busy={starting} disabled={busy || starting} onPress={() => void startApplication()} style={{ flex: 1 }} />
                ) : null}
                <Button write testID="call-save-outcome" label={onNext ? "Save · next lead" : "Save outcome"} icon={onNext ? "skip" : undefined} busy={busy}
                  disabled={!chosen || step === "done" || (callbackKey !== null && chosen === callbackKey)} onPress={() => { if (chosen) void save(chosen); }} style={{ flex: 1 }} />
              </View>
            </Bar>
          </>
        ) : null}

        {/* C9 · schedule the callback in the customer's time, over the outcome screen. */}
        {step === "callback" && panel ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
            <Dim onPress={() => setStep("outcome")} />
            <SheetPanel title={`Call ${firstName(panel.lead.fullName)} back`} onClose={() => setStep("outcome")}>
              {zone && callbackKey ? (
                <CallbackPicker zone={zone} state={panel.lead.state} agentZone={panel.viewerTimezone} busy={busy} teamOption remindOption onSave={(local, o) => void save(callbackKey, local, o)} />
              ) : (
                <T>This lead has no time zone yet; book the callback from the computer.</T>
              )}
            </SheetPanel>
          </View>
        ) : null}

        {/* C8 · the more-menu: the sheets that sit over a call. */}
        {over === "menu" && panel ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
            <Dim onPress={() => setOver(null)} />
            <SheetPanel onClose={() => setOver(null)}>
              <View style={{ marginHorizontal: -16, paddingBottom: 8 }}>
                <Row first icon="listCheck" title="Compliance details" onPress={() => setOver("checks")} testID="call-menu-checks" />
                <Row icon="file" title="Script and rebuttals" onPress={() => setOver("script")} testID="call-menu-script" />
                {step === "outcome" || step === "callback" ? <Row icon="calendar" title="Book an appointment" onPress={() => setOver("book")} testID="call-menu-book" /> : null}
                {/* On the call, leaving for the lead would drop the outcome still to be saved. */}
                {step !== "oncall" ? <Row icon="user" title="Open the lead" onPress={() => { onClose(); router.push(`/lead/${leadId}` as never); }} testID="call-menu-lead" /> : null}
              </View>
            </SheetPanel>
          </View>
        ) : null}

        {/* C7b · every check the server ran for this number, as a sheet. */}
        {over === "checks" && panel ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
            <Dim onPress={() => setOver(null)} />
            <SheetPanel title={`Checks for ${phoneLabel(panel.lead.phone) ?? "this number"}`} onClose={() => setOver(null)}>
              <ChecksList checks={complianceChecks(panel, new Date(), viewerZone)} />
            </SheetPanel>
          </View>
        ) : null}

        {/* C7d · the script, rebuttals one tap away, and the lead's notes. */}
        {over === "script" && panel ? (
          <ScriptScreen leadId={leadId} source={panel.scriptSource}
            script={{ version: panel.script.version, sections: panel.script.sections ?? {}, id: panel.script.id, campaignId: panel.script.campaignId ?? null, productCode: panel.script.productCode }}
            rebuttals={panel.rebuttals ?? []} onBack={() => setOver(null)} />
        ) : null}

        {/* C8b · book an appointment on a licensed producer's calendar, in the customer's time. */}
        {over === "book" && panel ? (
          <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
            <Dim onPress={() => setOver(null)} />
            <SheetPanel title="Book an appointment" onClose={() => setOver(null)}>
              <BookAppointment leadId={leadId} leadName={panel.lead.fullName} customerZone={customerZone} viewerTimezone={panel.viewerTimezone}
                onBooked={(at) => {
                  const z = customerZone ?? viewerZone;
                  setOver(null);
                  setBooked(`${dayLabel(dayKey(new Date(at), z))}, ${clock(new Date(at), z)}`);
                  setTimeout(() => setBooked(null), 2500);
                }} />
            </SheetPanel>
          </View>
        ) : null}

        {/* C8 toast: iOS a pill under the bar, Android a snackbar above the bottom. */}
        {booked && step !== "done" ? <Snack text={`Appointment booked · ${booked}`} bottom={insets.bottom + 84} /> : null}
        {step === "done" ? <Snack text={queued ? "Saved on this phone · sends when you’re back online" : [chosenLabel ? `Outcome saved · ${chosenLabel}` : "Outcome saved", saidAfter].filter(Boolean).join(" · ")} bottom={insets.bottom + 84} /> : null}

        {/* C10 · the server said no: a dialog, the one place a notice may sit. */}
        {step === "refused" && over !== "checks" ? (
          <DialogLayer title="We can’t call this number" body={message ?? "The server refused this call."}
            actions={[
              onSkip ? { label: "Skip to the next lead", bold: true, onPress: () => { onClose(); onSkip(); }, testID: "call-skip-next" } : { label: "Close", bold: true, onPress: onClose, testID: "call-close" },
              // C10's second move: the checks the server ran, when the panel could be read.
              ...(panel ? [{ label: "See the checks", onPress: () => setOver("checks"), testID: "call-see-checks" }] : onSkip ? [{ label: "Close", onPress: onClose }] : []),
            ]} />
        ) : null}
      </View>
      <ModalCover />
    </Modal>
  );
}

/** C8 · "Note for the next agent": outlined (Android) or filled (iOS), saved with the outcome. */
function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const p = usePalette();
  const [focus, setFocus] = useState(false);
  const label = "Note for the next agent";
  const box = (
    <TextInput testID="call-note" value={value} onChangeText={onChange} multiline accessibilityLabel={label}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} maxLength={1000}
      style={{ minHeight: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: focus ? 2 : 1, borderColor: focus ? p.green : p.line2, paddingHorizontal: focus ? 13 : 14, paddingVertical: 14, fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.ink, textAlignVertical: "top" }} />
  );
  if (IOS) return <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}</View>;
  return (
    <View style={{ marginTop: 8 }}>
      {box}
      <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: p.canvas, fontFamily: F.m, fontSize: 12, color: focus ? p.greenInk : p.muted }}>{label}</Text>
    </View>
  );
}
