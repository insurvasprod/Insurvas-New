import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { ModalCover } from "@/components/states/privacy-cover";
import { F, IOS, Row } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * A pick list in the board's sheet (.sheet: grab bar, title, the iOS close button), the same frame as
 * Switch workspace (J5). One choice closes it; `multi` keeps it open and ticks each row.
 */
export function ChoiceSheet({ visible, title, options, selected, multi, onPick, onClose }: {
  visible: boolean; title: string; options: { key: string; label: string }[]; selected: string[]; multi?: boolean; onPick: (key: string) => void; onClose: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Board index.html 171: reduced motion turns the sheet's rise into a fade.
  const reduced = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reduced ? "fade" : "slide"} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: p.dim }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "75%", backgroundColor: p.sheet, borderTopLeftRadius: IOS ? 12 : 28, borderTopRightRadius: IOS ? 12 : 28, paddingTop: IOS ? 8 : 6, paddingBottom: insets.bottom + 20 }}>
        <View style={IOS ? { width: 36, height: 5, borderRadius: 3, backgroundColor: p.line2, alignSelf: "center", marginBottom: 8 } : { width: 32, height: 4, borderRadius: 2, backgroundColor: p.muted, opacity: 0.5, alignSelf: "center", marginTop: 6, marginBottom: 14 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 4, paddingHorizontal: 16, paddingBottom: 10 }}>
          <Text accessibilityRole="header" style={IOS ? { fontFamily: F.db, fontSize: 18, letterSpacing: -0.18, color: p.ink } : { fontFamily: F.ds, fontSize: 22, color: p.ink }}>{title}</Text>
          {IOS || multi ? (
            <Pressable accessibilityRole="button" accessibilityLabel={multi ? "Done" : "Close"} onPress={onClose} hitSlop={10}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}>
              <Icon name={multi ? "check" : "x"} size={16} color={p.muted} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView>
          {options.map((o, i) => {
            const on = selected.includes(o.key);
            return (
              <Row key={o.key} testID={`choice-${o.key}`} first={i === 0} title={o.label} selected={on} chevron={false}
                chip={on ? <Icon name="checkC" size={20} color={p.greenInk} /> : undefined}
                onPress={() => { onPick(o.key); if (!multi) onClose(); }} />
            );
          })}
        </ScrollView>
      </View>
      {/* Board M7 on iOS: the switcher cover inside this sheet's own layer. */}
      <ModalCover />
    </Modal>
  );
}
