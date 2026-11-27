import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Header } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

import { BottomBar, StepLine } from "./parts";

/**
 * One application step on screen (E2 · E2c · E3 · E4): back, "Application", the steps button, the
 * step line, the step's own body, and its next move in the bottom bar. The header is the kit's; the
 * stack never draws one.
 */
export function StepFrame({ back, onBack, onSteps, line, children, bar, testID }: {
  back: string; onBack: () => void; onSteps?: () => void;
  line: { left: string; right: string; total: number; current: number; onOpen?: () => void };
  children: ReactNode; bar?: ReactNode; testID?: string;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView testID={testID} behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <Header title="Application" large={false} back={back} onBack={onBack}
          actions={onSteps ? [{ icon: "listCheck", label: "All steps", onPress: onSteps }] : undefined}
          belowFull={<StepLine {...line} />} />
        <ScrollView contentContainerStyle={{ paddingBottom: (bar ? 150 : 40) + insets.bottom }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
        {bar ? <BottomBar>{bar}</BottomBar> : null}
      </View>
    </KeyboardAvoidingView>
  );
}
