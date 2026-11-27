import { useRef, useState, type ComponentRef } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { F } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board A2 `.otp`: six 46×56 boxes, 12px corners, 8px apart, Geist Mono 24 on the field colour; the
 * box being typed into gets the green ring. One hidden input takes the digits, so the phone's own
 * keypad and its one-time-code autofill (Messages on iOS, the SMS suggestion on Android) both work.
 */
export function OtpBoxes({ value, onChange, onFilled, error, testID }: { value: string; onChange: (v: string) => void; onFilled?: (v: string) => void; error?: boolean; testID?: string }) {
  const p = usePalette();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, 5);

  return (
    <Pressable accessible={false} onPress={() => input.current?.focus()} style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => {
        const on = focused && i === active;
        return (
          <View key={i} style={{ width: 46, height: 56, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: error ? p.bad : on ? p.green : p.line2, backgroundColor: p.field, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: F.mono, fontSize: 24, color: p.ink }}>{value[i] ?? ""}</Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        testID={testID}
        accessibilityLabel="Six-digit code"
        value={value}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, "").slice(0, 6);
          onChange(digits);
          if (digits.length === 6) onFilled?.(digits);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        caretHidden
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: "transparent" }}
      />
    </Pressable>
  );
}
