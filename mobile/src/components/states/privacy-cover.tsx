import { useEffect, useState } from "react";
import { AppState, Modal, Platform, StyleSheet, View } from "react-native";

import { Logo } from "@/components/logo";

/**
 * Board M7 · "The app switcher shows a plain cover, never client data" (rules: sensitive data stays off the
 * phone). The moment the app stops being the one in front — iOS "inactive" (the switcher, a system sheet),
 * Android "blur" (the recents screen) or either going to the background — this cover is drawn over everything,
 * so the snapshot the system keeps shows only the isotype on the lock screen's dark ground, in both themes.
 * It lifts when the app is in front again; the lock after five minutes is the session's (lib/session.tsx).
 *
 * Where it is drawn, so it is above whatever is open:
 *   Android  `SwitcherCover` is its own window (a Modal: a dialog window above the activity and above every
 *            sheet or dialog opened before it), status and navigation bars included.
 *   iOS      a Modal would be refused while another one is presented, so the cover is drawn inside each layer
 *            instead: the root view (`SwitcherCover`), every stack screen including modal and sheet screens
 *            (`ScreenCover`, the root Stack's `screenLayout`), and inside each RN Modal sheet (`ModalCover`).
 *
 * What JS cannot do: Android takes its recents thumbnail natively, so a cover drawn after "blur" can still
 * lose that race, and screenshots are not blocked. Both need expo-screen-capture (`preventScreenCaptureAsync`
 * sets FLAG_SECURE; `enableAppSwitcherProtectionAsync` blurs the iOS snapshot natively) — a native module that
 * needs a new development build, not installed yet.
 */
const COVER = "#0b1614";
const OLIVE = "#0d4037";
/** Android: a blur with no trip to the background (the notification shade, a system dialog) lifts after this. */
const BLUR_ONLY_MS = 1200;

/** Whether the app is out of the person's sight right now (or about to be). */
export function useCovered(): boolean {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const stopTimer = () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } };
    const change = AppState.addEventListener("change", (state) => { stopTimer(); setCovered(state !== "active"); });
    // Android has no "inactive": the recents screen blurs the window before the snapshot. The cover's own window
    // takes the focus, so the activity's "focus" may never come back while it is up: a blur that is not followed
    // by the background (the shade, a permission dialog) lifts on a timer instead of staying for good.
    const blur = Platform.OS === "android" ? AppState.addEventListener("blur", () => {
      setCovered(true);
      stopTimer();
      blurTimer = setTimeout(() => { blurTimer = null; if (AppState.currentState === "active") setCovered(false); }, BLUR_ONLY_MS);
    }) : null;
    const focus = Platform.OS === "android" ? AppState.addEventListener("focus", () => { stopTimer(); setCovered(false); }) : null;
    return () => { stopTimer(); change.remove(); blur?.remove(); focus?.remove(); };
  }, []);
  return covered;
}

export function PrivacyCover() {
  return (
    <View testID="privacy-cover" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: COVER, alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000 }]}>
      <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: OLIVE, alignItems: "center", justifyContent: "center" }}>
        <Logo size={52} />
      </View>
    </View>
  );
}

/** The root layout's cover: its own window on Android (above sheets and dialogs), the root view on iOS. */
export function SwitcherCover() {
  const covered = useCovered();
  if (Platform.OS === "android") {
    return (
      <Modal visible={covered} transparent animationType="none" statusBarTranslucent navigationBarTranslucent hardwareAccelerated onRequestClose={() => undefined}>
        <PrivacyCover />
      </Modal>
    );
  }
  return covered ? <PrivacyCover /> : null;
}

/**
 * iOS only (Android's cover is its own window above everything): the cover inside one layer that sits above the
 * root view — a stack screen (modal and sheet screens included) or an RN Modal's content. Put it last.
 */
export function ScreenCover() {
  const covered = useCovered();
  return Platform.OS === "ios" && covered ? <PrivacyCover /> : null;
}
/** The same, named for an RN Modal's content (choice sheets, dialogs, call sheets). */
export const ModalCover = ScreenCover;
