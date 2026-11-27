import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CallSheet } from "@/components/call-sheet";
import { clock, dayKey, deviceZone } from "@/components/calls/time";
import { Logo } from "@/components/logo";
import { F } from "@/components/ui";
import { callbackOpen, displayName } from "@/lib/format";
import { currentTabs, reachable } from "@/lib/links";
import { callsPartsFor } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { CallbackView, CallbacksAnswer } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/**
 * Board L5 · Ask Siri or Google: "What's my next callback?" answered on a card, as the assistant's own sheet draws
 * it — "Robert Chen at 11:30", "10:30 their time, Central. Wants a quote for $25,000.", then Open and Call now.
 * Every word is the server's (GET /api/app/callbacks: the customer, the time, the customer's zone, the callback's
 * note). Call now opens the dialer's call (the server's checks, the disclosure, then the phone's dialer), never a
 * raw tel: link.
 *
 * The lock-screen rule: an answer shows only once the app is unlocked (Face ID / fingerprint). Locked or signed out,
 * the card asks to unlock and reads nothing from the server.
 *
 * The assistant sheet is drawn in one fixed dark look (the board's), whatever the app's theme.
 */
export const QUESTION = "“What’s my next callback?”";
const LOOK = { back: "#0b1614", card: "#1f2a27", soft: "rgba(255, 255, 255, 0.7)", quiet: "rgba(255, 255, 255, 0.14)", go: "#07d6a0", onGo: "#04251d", tile: "#0d4037" };

export type NextCallbackAnswer =
  | { kind: "next"; title: string; line: string; leadId: string }
  | { kind: "none"; title: string; line: string };

/** "Central" from America/Chicago ("Central Standard Time"), "Eastern", "Pacific"; the zone's own name elsewhere. */
export function zoneWord(zone: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? zone;
  return name.replace(/ (Standard|Daylight|Summer) Time$/, "").replace(/ Time$/, "");
}

/** The spoken answer from the callbacks the server sent: the next one still to come, in both clocks, with its note. */
export function nextCallbackAnswer(callbacks: CallbackView[], now: Date, viewerZone: string): NextCallbackAnswer {
  const open = callbacks.filter((cb) => callbackOpen(cb.status));
  const next = open
    .filter((cb) => !cb.isOverdue && cb.status !== "missed" && Date.parse(cb.scheduledAtUtc) >= now.getTime())
    .sort((a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc))[0];
  if (!next) {
    const today = dayKey(now, viewerZone);
    const overdue = open.filter((cb) => cb.isOverdue || cb.status === "missed" || dayKey(new Date(cb.scheduledAtUtc), viewerZone) < today).length;
    return { kind: "none", title: "No callbacks coming up", line: overdue ? `${overdue} overdue ${overdue === 1 ? "callback still needs" : "callbacks still need"} a call.` : "Nothing is scheduled." };
  }
  const at = new Date(next.scheduledAtUtc);
  const zone = next.customerTimezone;
  const theirs = zone ? `${clock(at, zone, false)} their time, ${zoneWord(zone, at)}.` : null;
  const note = next.note?.trim() ? next.note.trim().replace(/([^.!?])$/, "$1.") : null;
  return { kind: "next", title: `${displayName(next.customerName)} at ${clock(at, viewerZone, false)}`, line: [theirs, note].filter(Boolean).join(" "), leadId: next.leadId };
}

function SheetButton({ label, go, onPress, testID }: { label: string; go?: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, height: 44, borderRadius: 12, backgroundColor: go ? LOOK.go : LOOK.quiet, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ fontFamily: go ? F.b : F.s, fontSize: 16, color: go ? LOOK.onGo : "#ffffff" }}>{label}</Text>
    </Pressable>
  );
}

/** The answer card for "What's my next callback?" (the /ask screen). */
export function VoiceAnswerScreen() {
  const insets = useSafeAreaInsets();
  const { status, api, me, unlock } = useSession();
  const open = status === "signedIn";
  const canCall = callsPartsFor(me?.role, me?.plan?.features).includes("dialer");
  const load = useLoad(async () => (open ? api<CallbacksAnswer>("/api/app/callbacks") : null), [open]);
  const [calling, setCalling] = useState<string | null>(null);
  const answer = load.data ? nextCallbackAnswer(load.data.callbacks, new Date(), deviceZone()) : null;
  const close = () => (router.canGoBack() ? router.back() : router.replace("/" as Href));

  let title: string;
  let line: string | null;
  if (!open) { title = "Unlock Insurvas to hear it"; line = "Answers show only after Face ID or your fingerprint."; }
  else if (answer) { title = answer.title; line = answer.line || null; }
  else if (load.error) { title = "We couldn’t check your callbacks"; line = load.error; }
  else { title = "Checking your callbacks…"; line = null; }

  return (
    <View style={{ flex: 1, backgroundColor: LOOK.back }}>
      <StatusBar style="light" />
      <Pressable testID="ask-backdrop" accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ flex: 1 }} />
      <View testID="ask-card" style={{ marginHorizontal: 14, marginBottom: Math.max(insets.bottom, 0) + 30, borderRadius: 28, backgroundColor: LOOK.card, padding: 18 }}>
        <Text style={{ fontFamily: F.r, fontSize: 15, color: LOOK.soft }}>{QUESTION}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }}>
          <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: LOOK.tile, alignItems: "center", justifyContent: "center" }}>
            <Logo size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="ask-title" style={{ fontFamily: F.s, fontSize: 17, color: "#ffffff" }}>{title}</Text>
            {line ? <Text testID="ask-line" style={{ fontFamily: F.r, fontSize: 14, lineHeight: 19, color: LOOK.soft }}>{line}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          {!open ? (
            // Locked: the phone's check opens the app and this card then reads the answer (the screen sits outside the
            // root layout's doors, so it stays). Signed out there is no session to open: the password sign-in.
            status === "locked"
              ? <SheetButton testID="ask-unlock" label="Unlock" go onPress={() => void unlock().catch(() => undefined)} />
              : <SheetButton testID="ask-unlock" label="Sign in" go onPress={() => router.replace("/sign-in" as Href)} />
          ) : answer?.kind === "next" ? (
            <>
              <SheetButton testID="ask-open" label="Open" onPress={() => router.replace(`/lead/${answer.leadId}` as Href)} />
              {canCall ? <SheetButton testID="ask-call" label="Call now" go onPress={() => setCalling(answer.leadId)} /> : null}
            </>
          ) : answer ? (
            <SheetButton testID="ask-callbacks" label="Open callbacks" onPress={() => router.replace(reachable("/calls?part=callbacks", currentTabs()) as Href)} />
          ) : null}
        </View>
      </View>
      {open && calling ? <CallSheet leadId={calling} visible backLabel="Back" onClose={() => setCalling(null)} onSaved={() => { setCalling(null); load.reload(); }} /> : null}
    </View>
  );
}
