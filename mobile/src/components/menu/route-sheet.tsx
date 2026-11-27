import { useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * A route drawn as the board's sheet (kit.js `k.sheet`, kit.css .dim / .sheet): the screen it was opened
 * from stays behind a dim, the sheet rises from the bottom with its grab bar, then the title row
 * (.sht: 18px bold on iOS with the round close button, 22px medium on Android with none). `minHeight` is
 * the board's own sheet height (`{ h }`). Tapping the dim, the close button or Back closes it.
 */
export function RouteSheet({ title, minHeight, children, testID }: { title?: string; minHeight?: number; children: ReactNode; testID?: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Board index.html 171: reduced motion fades the sheet in instead of raising it.
  const reduced = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: reduced ? 200 : 260, useNativeDriver: true }).start();
  }, [rise, reduced]);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View testID={testID} style={{ flex: 1 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.dim, opacity: rise }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", minHeight: minHeight ? minHeight + insets.bottom : undefined,
          backgroundColor: p.sheet, borderTopLeftRadius: IOS ? 14 : 28, borderTopRightRadius: IOS ? 14 : 28, paddingTop: 8, paddingBottom: 34 + insets.bottom, overflow: "hidden",
          ...(reduced ? { opacity: rise } : { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }),
        }}>
        <View style={IOS ? { width: 36, height: 5, borderRadius: 3, backgroundColor: p.line2, alignSelf: "center", marginBottom: 8 } : { width: 32, height: 4, borderRadius: 2, backgroundColor: p.muted, opacity: 0.5, alignSelf: "center", marginTop: 6, marginBottom: 14 }} />
        {title ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4, paddingHorizontal: 16, paddingBottom: 10 }}>
            <Text accessibilityRole="header" style={IOS ? { fontFamily: F.db, fontSize: 18, letterSpacing: -0.18, color: p.ink } : { fontFamily: F.dm, fontSize: 22, color: p.ink }}>{title}</Text>
            {IOS ? (
              <Pressable testID="sheet-close" accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}>
                <Icon name="x" size={16} color={p.muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {children}
      </Animated.View>
    </View>
  );
}
