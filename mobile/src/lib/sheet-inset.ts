import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Whether the Android keyboard is up. Always false on iOS, where the system lays out around it. */
export function useAndroidKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

/**
 * The bottom padding a sheet keeps clear of the gesture bar. On Android the window already shrinks
 * above the keyboard, and inside a Modal the safe-area bottom inset also grows by the keyboard's
 * height, so using it while typing counts the keyboard twice: the form collapses to one field over
 * an empty band. While the keyboard is up on Android the inset is therefore 0.
 */
export function useSheetBottomInset(): number {
  const insets = useSafeAreaInsets();
  return useAndroidKeyboardShown() ? 0 : insets.bottom;
}
