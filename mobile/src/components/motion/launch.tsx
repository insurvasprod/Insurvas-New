"use no memo";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeOut, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import * as SplashScreen from "expo-splash-screen";
import { SvgXml } from "react-native-svg";

import { ISOTYPE_ON_DARK } from "@/components/isotype";

/**
 * The launch (owner 2026-11-26: "a loading animation whenever they open the app"), inside the board's motion rules
 * (index.html 165–170: 120–360 ms rises and fades, nothing endless, reduced motion = a fade).
 *
 *   1. The native splash (#08110f, the 96 px mark) hands over to this cover drawn at the same size and place.
 *   2. The mark's eight ribbons fade in from the inside out, 40 ms apart; the wordmark rises 6 px beneath it.
 *   3. It holds still (never loops) until the session has started, at least long enough to be read, then the
 *      whole cover fades out over 280 ms onto the first screen.
 */
const SPLASH = "#08110f";
const MARK = 96;
const CURVE = Easing.bezier(0.22, 1, 0.36, 1);

/** The isotype split into its ribbons (inner first) plus the dark accent strokes, so each can fade on its own. */
const LAYERS: string[] = (() => {
  const open = ISOTYPE_ON_DARK.slice(0, ISOTYPE_ON_DARK.indexOf("<g>"));
  const ribbons = ISOTYPE_ON_DARK.match(/<path fill="url\([^"]+\)"[^>]*\/>/g) ?? [];
  const accents = ISOTYPE_ON_DARK.match(/<path fill="#0a8769"[^>]*\/>/g) ?? [];
  const svg = (inner: string) => `${open}<g>${inner}</g></svg>`;
  return ribbons.length ? [...ribbons.map((r) => svg(r)), svg(accents.join(""))] : [ISOTYPE_ON_DARK];
})();

function Layer({ xml, index, reduced }: { xml: string; index: number; reduced: boolean }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withDelay(reduced ? 0 : 60 + index * 40, withTiming(1, { duration: reduced ? 200 : 320, easing: CURVE, reduceMotion: ReduceMotion.Never }));
  }, [shown, index, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: reduced ? 1 : 0.96 + shown.value * 0.04 }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <SvgXml xml={xml} width={MARK} height={MARK} />
    </Animated.View>
  );
}

/** Drawn over the app until `ready`; then it fades away and unmounts. */
export function LaunchCover({ ready }: { ready: boolean }) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(true);
  const word = useSharedValue(0);

  useEffect(() => {
    // The cover now sits exactly where the native splash was, so the hand-over is invisible.
    void SplashScreen.hideAsync();
    word.value = withDelay(reduced ? 0 : 60 + LAYERS.length * 40, withTiming(1, { duration: reduced ? 200 : 300, easing: CURVE, reduceMotion: ReduceMotion.Never }));
    // Long enough to be read once, short enough never to be in the way.
    const t = setTimeout(() => setHeld(false), reduced ? 250 : 60 + LAYERS.length * 40 + 360);
    return () => clearTimeout(t);
  }, [word, reduced]);

  // Gone once the app is ready and the mark has been seen; the exiting fade plays as it unmounts.
  const gone = ready && !held;

  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: reduced ? 0 : (1 - word.value) * 6 }] }));

  if (gone) return null;
  return (
    <Animated.View pointerEvents="none" exiting={FadeOut.duration(reduced ? 160 : 280).easing(CURVE)} style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH, alignItems: "center", justifyContent: "center" }]} testID="launch-cover">
      <View style={{ width: MARK, height: MARK }} accessibilityLabel="Insurvas" accessible>
        {LAYERS.map((xml, i) => <Layer key={i} xml={xml} index={i} reduced={reduced} />)}
      </View>
      <Animated.View style={[{ position: "absolute", top: "50%", marginTop: MARK / 2 + 18 }, wordStyle]}>
        <Text style={{ fontFamily: "InterTight_600SemiBold", fontSize: 20, letterSpacing: -0.3, color: "#f2f7f5" }}>Insurvas</Text>
      </Animated.View>
    </Animated.View>
  );
}
