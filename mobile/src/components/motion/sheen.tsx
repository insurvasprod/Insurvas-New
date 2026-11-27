"use no memo";
import { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { usePalette } from "@/theme/use-palette";

/**
 * Board M1 · skeleton rows (.skrow: a 30 px tile, a 55 % / 12 px line over an 80 % / 10 px line, a 56 × 22 pill),
 * drawn only after 180 ms (frame first). The sheen is "the only motion that waits": a soft band crosses the rows
 * while the screen is loading and stops the moment the rows are replaced. No gradient (board rule): a flat band
 * of the ink colour at 5 %. Reduced motion: the rows stay still.
 */
export function SheenRows({ rows = 6 }: { rows?: number }) {
  const p = usePalette();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 180);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!visible || reduced || !width) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.Never }), -1, false);
    return () => cancelAnimation(x);
  }, [visible, reduced, width, x]);

  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.4 + x.value * width * 1.4 }] }));
  if (!visible) return <View accessibilityLabel="Loading" style={{ height: rows * 58 }} />;

  const bar = (w: number | `${number}%`, h: number) => <View style={{ width: w, height: h, borderRadius: 6, backgroundColor: p.surf2 }} />;
  return (
    <View accessibilityLabel="Loading" onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ overflow: "hidden" }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: p.surf2 }} />
          <View style={{ flex: 1, gap: 7 }}>{bar("55%", 12)}{bar("80%", 10)}</View>
          {bar(56, 22)}
        </View>
      ))}
      {!reduced && width ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: width * 0.4, backgroundColor: p.ink, opacity: 0.05 }, band]} /> : null}
    </View>
  );
}
