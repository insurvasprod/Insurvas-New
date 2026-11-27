import { useSyncExternalStore } from "react";
import { Appearance, useColorScheme } from "react-native";

import { readSecret, writeSecret } from "@/lib/secure";

import { dark, light, type Palette } from "./tokens";

/**
 * The app's colours follow Settings › Appearance (board J3): Dark, Light, or System (the phone's own
 * light / dark setting, the default). The choice is this phone's, kept in the secure store, and set on
 * the native side too so the status bar and the platform's own controls follow it.
 */
export type AppearanceChoice = "system" | "light" | "dark";

const KEY = "insurvas.appearance";
let choice: AppearanceChoice = "system";
const listeners = new Set<() => void>();

function apply(next: AppearanceChoice) {
  choice = next;
  try { Appearance.setColorScheme?.(next === "system" ? "unspecified" : next); } catch { /* no native module (tests, web) */ }
  for (const l of listeners) l();
}

function isChoice(v: unknown): v is AppearanceChoice {
  return v === "system" || v === "light" || v === "dark";
}

// Read once at start; until it lands the phone's own setting shows (the same as System).
void readSecret(KEY).then((saved) => { if (isChoice(saved) && saved !== choice) apply(saved); }, () => undefined);

/** Change the phone's appearance and remember it. */
export async function setAppearance(next: AppearanceChoice): Promise<void> {
  apply(next);
  await writeSecret(KEY, next === "system" ? null : next).catch(() => undefined);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The Appearance choice (Dark, Light, System). */
export function useAppearance(): AppearanceChoice {
  return useSyncExternalStore(subscribe, () => choice, () => choice);
}

/** The palette for the chosen appearance; System follows the phone's light / dark setting. */
export function usePalette(): Palette {
  const picked = useAppearance();
  const scheme = useColorScheme();
  const mode = picked === "system" ? scheme : picked;
  return mode === "light" ? light : dark;
}
