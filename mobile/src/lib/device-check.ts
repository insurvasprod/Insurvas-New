import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

/**
 * Board M7 · the lock (after five minutes away, or a cold start with a saved session) always asks the phone who
 * is holding it — Face ID / fingerprint, or the phone's own passcode / PIN / pattern when biometrics are off or
 * not set up (`disableDeviceFallback: false`). It is never skipped: a phone with no screen lock at all cannot
 * prove its owner, so the app asks for the password sign-in instead of opening (`noLock`).
 *
 * Shared by the agency session (lib/session.tsx) and the partner session (components/partner/session.tsx).
 */
export type DeviceCheck = "passed" | "refused" | "noLock";

export async function checkDeviceOwner(promptMessage = "Unlock Insurvas"): Promise<DeviceCheck> {
  // The web preview is a development tool with no device lock to ask.
  if (Platform.OS === "web") return "passed";
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (level === LocalAuthentication.SecurityLevel.NONE) return "noLock";
  const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel", disableDeviceFallback: false }).catch(() => ({ success: false }));
  return result.success ? "passed" : "refused";
}
