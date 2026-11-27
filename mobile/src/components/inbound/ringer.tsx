import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";

import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { F } from "@/components/ui";
import { mss, nextRing, waitingLine } from "./model";
import { ModalCover } from "@/components/states/privacy-cover";

/**
 * Board C2 · A transfer rings, inside the app. Expo Go has no full-screen native call UI (CallKit /
 * a call-style notification need a development build), so while the app is open a new transfer takes
 * the whole screen the way the board draws the Lock Screen card: who, where from, the wait counting up,
 * Pass or Take call. Take call is the same race-safe claim (POST /api/app/inbound/claim) and opens
 * Caller profile; Pass only stops the ring on this phone — the caller keeps waiting for everyone else.
 *
 * The lock-screen colours are the board's own fixed ones (kit.css .lock / .live / .noti), not theme
 * tokens: the screen is dark in both themes, as a lock screen is.
 */
export type Ringable = { id: string; customer: string; age?: string | null; productLine: string | null; state: string | null; waitSeconds: number; screening: string };

type RingState = { prev: string[] | null; passed: string[]; ringing: string | null };

/** Which waiting transfer is ringing; `observe` runs on every read of /api/app/inbound/waiting. */
export function useRinger() {
  const [s, setS] = useState<RingState>({ prev: null, passed: [], ringing: null });
  return {
    ringing: s.ringing,
    observe(items: { id: string; waitSeconds: number }[], presence: string | null | undefined, readOnly: boolean) {
      setS((cur) => {
        const ids = items.map((i) => i.id);
        // Still ringing while it is still waiting; claimed by someone else, it stops.
        const keep = cur.ringing && ids.includes(cur.ringing) ? cur.ringing : null;
        const ringing = keep ?? nextRing(cur.prev, items, cur.passed, presence, readOnly);
        return { prev: ids, passed: cur.passed.filter((id) => ids.includes(id)), ringing };
      });
    },
    pass(id: string) { setS((cur) => ({ ...cur, passed: [...cur.passed, id], ringing: cur.ringing === id ? null : cur.ringing })); },
    stop() { setS((cur) => ({ ...cur, ringing: null })); },
  };
}

const IOS = Platform.OS !== "android";
const WALL = "#0b1614";
const GREEN = "#07d6a0";
const ON_GREEN = "#04251d";

export function TransferRinger({ item, wait, busy, onTake, onPass }: { item: Ringable | null; wait: number; busy: boolean; onTake: () => void; onPass: () => void }) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const ringingId = item?.id ?? null;
  useEffect(() => {
    if (!ringingId) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [ringingId]);
  if (!item) return null;

  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?(AM|PM)$/i, "");
  const date = IOS
    ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(",", "")
    : now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(/^(\w+)/, "$1,");
  const line = [waitingLine(item) || null, item.screening || null].filter(Boolean).join(" · ");

  const take = (
    <Pressable testID="ring-take" accessibilityRole="button" accessibilityLabel="Take call" disabled={busy} onPress={onTake}
      style={({ pressed }) => ({ flex: IOS ? 2 : 1, height: IOS ? 46 : 48, borderRadius: IOS ? 14 : 24, backgroundColor: GREEN, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1 })}>
      {busy ? <ActivityIndicator color={ON_GREEN} /> : <Icon name="phoneIn" size={18} color={ON_GREEN} />}
      <Text style={{ fontFamily: F.b, fontSize: 16, color: ON_GREEN }}>Take call</Text>
    </Pressable>
  );
  const pass = (
    <Pressable testID="ring-pass" accessibilityRole="button" accessibilityLabel="Pass" disabled={busy} onPress={onPass}
      style={({ pressed }) => ({ flex: 1, height: IOS ? 46 : 48, borderRadius: IOS ? 14 : 24, backgroundColor: IOS ? "rgba(255,255,255,0.14)" : "#3a2422", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1 })}>
      {IOS ? null : <Icon name="x" size={18} color="#f0837c" />}
      <Text style={{ fontFamily: F.s, fontSize: 16, color: IOS ? "#ffffff" : "#f0837c" }}>Pass</Text>
    </Pressable>
  );
  const who = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: IOS ? 10 : 0 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: IOS ? 20 : 19, color: "#ffffff" }}>{item.customer}</Text>
        {line ? <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 14, color: "rgba(255,255,255,0.75)" }}>{line}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontFamily: F.db, fontSize: IOS ? 28 : 26, color: "#ffffff", fontVariant: ["tabular-nums"] }}>{mss(wait)}</Text>
        {IOS ? <Text style={{ fontFamily: F.r, fontSize: 12, color: "rgba(255,255,255,0.7)" }}>waiting</Text> : null}
      </View>
    </View>
  );

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onPass}>
      <View testID="ringer" style={{ flex: 1, backgroundColor: WALL, alignItems: "center", paddingTop: insets.top }}>
        {/* .lock .wall — thin green lines at 118°, 7% */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <Pattern id="wall" patternUnits="userSpaceOnUse" width={23} height={23} patternTransform="rotate(28)">
              <Line x1={0} y1={0} x2={0} y2={23} stroke="rgba(7,214,160,0.07)" strokeWidth={1} />
            </Pattern>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill="url(#wall)" />
        </Svg>
        {IOS ? (
          <>
            <Text style={{ marginTop: 14, fontFamily: F.m, fontSize: 19, color: "rgba(255,255,255,0.9)" }}>{date}</Text>
            <Text style={{ fontFamily: F.ds, fontSize: 92, lineHeight: 96, letterSpacing: -3.7, color: "#ffffff" }}>{time}</Text>
          </>
        ) : (
          <>
            <Text style={{ marginTop: 40, fontSize: 110, lineHeight: 116, fontWeight: "300", color: "#ffffff" }}>{time}</Text>
            <Text style={{ marginTop: 6, fontFamily: F.m, fontSize: 19, color: "rgba(255,255,255,0.9)" }}>{date}</Text>
          </>
        )}
        <View style={{ flex: 1 }} />
        {IOS ? (
          <View style={{ width: "94%", borderRadius: 24, backgroundColor: "rgba(18,22,21,0.92)", paddingVertical: 14, paddingHorizontal: 16, marginBottom: 96 + insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: "#0d4037", alignItems: "center", justifyContent: "center" }}><Logo size={14} /></View>
                <Text style={{ fontFamily: F.r, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Insurvas · Incoming transfer</Text>
              </View>
              <Text style={{ fontFamily: F.r, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>now</Text>
            </View>
            {who}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>{pass}{take}</View>
          </View>
        ) : (
          <View style={{ width: "94%", borderRadius: 24, backgroundColor: "#1f2a27", padding: 16, gap: 6, marginBottom: 84 + insets.bottom }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#0d4037", alignItems: "center", justifyContent: "center" }}><Logo size={14} /></View>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, color: "rgba(255,255,255,0.8)" }}>Insurvas · Incoming transfer · now</Text>
            </View>
            {who}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>{pass}{take}</View>
          </View>
        )}
      </View>
      <ModalCover />
    </Modal>
  );
}
