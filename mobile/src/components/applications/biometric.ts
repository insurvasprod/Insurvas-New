import * as LocalAuthentication from "expo-local-authentication";

import { IOS } from "@/components/ui";

/** What the board calls the check (E2c): Face ID on an iPhone, the fingerprint on Android. */
export const BIOMETRIC_WORD = IOS ? "Face ID" : "your fingerprint";

/**
 * Board E2c · "showing again needs Face ID / fingerprint". The platform draws its own prompt (on
 * Android the system sheet the board copies: title, "Confirm it's you", the sensor, Cancel). A phone
 * with no biometrics enrolled falls back to its passcode, so the check is never skipped silently.
 */
export async function confirmItsYou(title: string): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: title,
      promptSubtitle: "Confirm it’s you",
      cancelLabel: "Cancel",
      // Without enrolled biometrics the phone's own passcode is the check.
      disableDeviceFallback: hardware && enrolled,
    });
    if (result.success) return { ok: true };
    return { ok: false, why: result.error === "user_cancel" || result.error === "system_cancel" || result.error === "app_cancel" ? "" : "That didn’t match. The numbers stay hidden." };
  } catch {
    return { ok: false, why: "This phone can’t confirm it’s you, so the numbers stay hidden." };
  }
}
