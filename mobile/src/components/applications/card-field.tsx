import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { Icon } from "@/components/icon";
import { F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * The kit's field (.fld) as it sits inside a card (E1's quote inputs): Android's floating label is cut
 * out of the card's colour, not the screen's, which the shared Field does not do. Either typed, or a
 * picker when `onPress` is given.
 */
export function CardField({ label, value, onPress, testID, ...input }: TextInputProps & { label: string; value: string; onPress?: () => void }) {
  const p = usePalette();
  const [focus, setFocus] = useState(false);
  const ring = focus ? 2 : 1;
  const box = (
    <View style={{ height: IOS ? 50 : 56, borderRadius: IOS ? 12 : 8, backgroundColor: IOS ? p.field : "transparent", borderWidth: ring, borderColor: focus ? p.green : p.line2, flexDirection: "row", alignItems: "center", paddingHorizontal: ring === 2 ? 13 : 14, gap: 8 }}>
      {onPress ? (
        <>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.r, fontSize: 16, color: value ? p.ink : p.faint }}>{value || "Choose"}</Text>
          <Icon name="chevD" size={18} color={p.muted} />
        </>
      ) : (
        <TextInput testID={testID} accessibilityLabel={label} value={value} placeholderTextColor={p.faint} {...input}
          onFocus={(e) => { setFocus(true); input.onFocus?.(e); }} onBlur={(e) => { setFocus(false); input.onBlur?.(e); }}
          style={{ flex: 1, height: "100%", fontFamily: F.r, fontSize: 16, color: p.ink, paddingVertical: 0 }} />
      )}
    </View>
  );
  const framed = IOS
    ? <View style={{ gap: 6 }}><Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{label}</Text>{box}</View>
    : (
      <View style={{ marginTop: 8 }}>
        {box}
        <Text style={{ position: "absolute", top: -8, left: 12, paddingHorizontal: 4, backgroundColor: p.surf, fontFamily: F.m, fontSize: 12, color: focus ? p.greenInk : p.muted }}>{label}</Text>
      </View>
    );
  if (!onPress) return <View style={{ flex: 1 }}>{framed}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value || "not chosen"}`} onPress={onPress} style={{ flex: 1 }}>{framed}</Pressable>;
}
