import { useState } from "react";
import { PanResponder, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Path } from "react-native-svg";

import { usePalette } from "@/theme/use-palette";

export type Stroke = { x: number; y: number }[];

/** A stroke as an SVG path: a dot for a tap, straight segments between the touches otherwise. */
export function strokePath(s: Stroke): string {
  if (!s.length) return "";
  const [h, ...rest] = s;
  if (!rest.length) return `M${h.x} ${h.y}l0.1 0.1`;
  return `M${h.x.toFixed(1)} ${h.y.toFixed(1)}` + rest.map((pt) => `L${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join("");
}

const at = (e: GestureResponderEvent) => ({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });

/**
 * Board E4 · .sigbox: 150px, 14px corners, a dashed line2 border on the field colour, the signing
 * line 34px from the bottom with an × at its start. The finger draws in ink. Plain react-native-svg
 * and the responder system, so it runs in Expo Go with nothing native added. The strokes are the
 * parent's (so Clear is the parent's too); the one being drawn is the pad's own until the finger lifts.
 */
export function SignaturePad({ strokes, onChange, testID }: { strokes: Stroke[]; onChange: (next: Stroke[]) => void; testID?: string }) {
  const p = usePalette();
  const [live, setLive] = useState<Stroke | null>(null);
  const end = () => { if (live?.length) onChange([...strokes, live]); setLive(null); };
  // Rebuilt with each render so a lift always hands up the latest stroke.
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // A signature drags sideways and down; the screen must not take the touch away mid-stroke.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => setLive([at(e)]),
    onPanResponderMove: (e) => { const pt = at(e); setLive((s) => (s ? [...s, pt] : [pt])); },
    onPanResponderRelease: end,
    onPanResponderTerminate: end,
  });

  return (
    <View testID={testID} accessible accessibilityLabel="Sign here" accessibilityHint="Draw the signature with a finger"
      style={{ height: 150, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: p.line2, backgroundColor: p.field, overflow: "hidden" }}
      {...responder.panHandlers}>
      <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, bottom: 34, borderTopWidth: 1, borderTopColor: p.line2 }} />
      <Text style={{ position: "absolute", left: 20, bottom: 40, fontSize: 18, color: p.muted }}>×</Text>
      <Svg pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
        {[...strokes, ...(live ? [live] : [])].map((s, i) => <Path key={i} d={strokePath(s)} stroke={p.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
      </Svg>
    </View>
  );
}
