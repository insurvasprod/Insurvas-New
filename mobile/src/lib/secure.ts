import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Tokens live in the iOS Keychain / Android Keystore, readable only while the phone is unlocked and
 * never restored onto another phone. SecureStore has no web build; the web preview (development only)
 * uses localStorage so the screens can be tried in a browser.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function readSecret(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key, OPTIONS); } catch { return null; }
}

export async function writeSecret(key: string, value: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch { /* private window: the preview simply forgets */ }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => undefined);
  else await SecureStore.setItemAsync(key, value, OPTIONS);
}

export const KEYS = {
  access: "insurvas.access",
  expiresAt: "insurvas.expiresAt",
  refresh: "insurvas.refresh",
  /** The 30-day "trust this phone" token from the code step. Kept across sign-outs, like the browser's. */
  trusted: "insurvas.trusted",
  /** "Unlock with Face ID" — on unless the person turns it off in Settings. */
  biometric: "insurvas.biometric",
  pushToken: "insurvas.pushToken",
} as const;
