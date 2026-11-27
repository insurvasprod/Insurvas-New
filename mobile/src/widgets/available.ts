import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

/**
 * Whether this build carries the Android widget module (a development or store build, never Expo Go or the web).
 * react-native-android-widget requires its native module the moment it is imported, so every widget import in the
 * app is a lazy require behind this check.
 */
export const widgetsAvailable: boolean =
  Platform.OS === "android" && (TurboModuleRegistry.get("AndroidWidget") != null || NativeModules.AndroidWidget != null);
