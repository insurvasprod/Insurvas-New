"use no memo";
import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

/**
 * The calm rise (board index.html 165–170, the web's calm-premium tokens): content arrives with a 240 ms fade and
 * an 8 px rise, `delay` ms after it mounts (sections 50 ms apart). Never repeats; reduced motion keeps the fade
 * only, at 160 ms.
 */
const CURVE = Easing.bezier(0.22, 1, 0.36, 1);

export function Rise({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withDelay(reduced ? 0 : delay, withTiming(1, { duration: reduced ? 160 : 240, easing: CURVE, reduceMotion: ReduceMotion.Never }));
  }, [shown, delay, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: reduced ? 0 : (1 - shown.value) * 8 }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
