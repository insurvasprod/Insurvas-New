import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { ModalCover } from "@/components/states/privacy-cover";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * The board's .dlg (kit.css): iOS a 280px alert, centred, actions stacked under hairlines, the first
 * one bold; Android a 320px Material dialog, 28px corners, left-aligned, actions on the right in
 * reverse order. Over the screen's dim. It only fades (never slides), so reduced motion needs nothing more.
 */
export type DialogAction = { label: string; onPress: () => void; bold?: boolean; testID?: string };

export function Dialog({ visible, title, body, actions }: { visible: boolean; title: string; body: string; actions: DialogAction[] }) {
  const p = usePalette();
  const list = IOS ? actions : [...actions].reverse();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => actions[actions.length - 1]?.onPress()}>
      <View style={{ flex: 1, backgroundColor: p.dim, alignItems: "center", justifyContent: "center" }}>
        {IOS ? (
          <View accessibilityRole="alert" style={{ width: 280, borderRadius: 16, overflow: "hidden", backgroundColor: p.elev }}>
            <Text style={{ paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, fontFamily: F.s, fontSize: 17, color: p.ink, textAlign: "center" }}>{title}</Text>
            <Text style={{ paddingHorizontal: 16, paddingBottom: 16, fontFamily: F.r, fontSize: 14, lineHeight: 19.6, color: p.body, textAlign: "center" }}>{body}</Text>
            {list.map((a) => (
              <Pressable key={a.label} testID={a.testID} accessibilityRole="button" onPress={a.onPress} style={({ pressed }) => ({ padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line2, backgroundColor: pressed ? p.surf2 : "transparent" })}>
                <Text style={{ fontFamily: a.bold ? F.s : F.r, fontSize: 17, color: p.greenInk, textAlign: "center" }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View accessibilityRole="alert" style={{ width: 320, borderRadius: 28, padding: 24, backgroundColor: p.sheet }}>
            <Text style={{ marginBottom: 12, fontFamily: F.ds, fontSize: 22, color: p.ink }}>{title}</Text>
            <Text style={{ fontFamily: F.r, fontSize: 14.5, lineHeight: 20.3, color: p.body }}>{body}</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
              {list.map((a) => (
                <Pressable key={a.label} testID={a.testID} accessibilityRole="button" onPress={a.onPress} android_ripple={{ color: p.surf2 }} style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 }}>
                  <Text style={{ fontFamily: F.s, fontSize: 14.5, color: p.greenInk }}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>
      {/* Board M7 on iOS: the switcher cover inside this dialog's own layer. */}
      <ModalCover />
    </Modal>
  );
}
