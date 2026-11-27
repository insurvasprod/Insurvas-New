import { useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";

import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board H1's swipe: drag a row left and the actions behind it show, Snooze (info) then Read (green), 84px
 * each. Let go past halfway and the row stays open; tap an action, tap the row or drag back to close. The
 * action buttons stay reachable to a screen reader without the gesture.
 */
export type SwipeAction = { key: string; label: string; tone: "info" | "green"; onPress: () => void };

const WIDTH = 84;

export function SwipeRow({ actions, children, testID }: { actions: SwipeAction[]; children: ReactNode; testID?: string }) {
  const p = usePalette();
  const open = actions.length * WIDTH;
  const [x] = useState(() => new Animated.Value(0));
  // Where the row rests (0 or open), read by the drag; not state, nothing redraws for it.
  const [at] = useState(() => ({ current: 0 }));
  const [shown, setShown] = useState(false);

  // Built once (the values it moves are stable): where the row rests, and the drag that moves it.
  const [{ settle, pan }] = useState(() => {
    const go = (to: number) => {
      at.current = to;
      setShown(to !== 0);
      Animated.timing(x, { toValue: to, duration: 180, useNativeDriver: true }).start();
    };
    const responder = PanResponder.create({
      // Only a sideways drag takes the touch; an up-and-down one stays the list's scroll.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => x.setValue(Math.max(-open - 24, Math.min(0, at.current + g.dx))),
      onPanResponderRelease: (_e, g) => go(at.current + g.dx < -open / 2 ? -open : 0),
      onPanResponderTerminate: () => go(at.current),
    });
    return { settle: go, pan: responder };
  });

  const run = (a: SwipeAction) => { settle(0); a.onPress(); };

  return (
    <View testID={testID} style={{ overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, flexDirection: "row" }}>
        {actions.map((a) => (
          <Pressable key={a.key} testID={testID ? `${testID}-${a.key}` : undefined} accessibilityRole="button" accessibilityLabel={a.label} onPress={() => run(a)}
            style={{ width: WIDTH, alignItems: "center", justifyContent: "center", backgroundColor: a.tone === "info" ? p.info : p.green }}>
            <Text style={{ fontFamily: F.s, fontSize: 13, color: a.tone === "info" ? "#fff" : p.onGreen }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View {...pan.panHandlers} style={{ backgroundColor: IOS ? p.surf : p.canvas, transform: [{ translateX: x }] }}>
        {children}
        {shown ? <Pressable accessibilityLabel="Close actions" onPress={() => settle(0)} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} /> : null}
      </Animated.View>
    </View>
  );
}
