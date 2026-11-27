import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";

import { KEYS, readSecret, writeSecret } from "./secure";

/**
 * After the first good sign-in on this phone (board A7 → A3 → A4), in that order, each only when it
 * applies: pick a workspace (more than one), turn on alerts (the phone has not been asked yet), and
 * Face ID / fingerprint next time (the phone has one set up and the choice has not been made). Later
 * sign-ins skip all three; Settings changes each one.
 */
export type SetupStep = "workspace" | "alerts" | "biometric";

/** Set once a sign-in has finished on this phone; A0 (First open) shows only before it. */
export const SEEN_KEY = "insurvas.signedInBefore";

export function planSetup(input: { seenBefore: boolean; workspaces: number; alertsUndecided: boolean; biometricReady: boolean; biometricChosen: boolean }): SetupStep[] {
  if (input.seenBefore) return [];
  const steps: SetupStep[] = [];
  if (input.workspaces > 1) steps.push("workspace");
  if (input.alertsUndecided) steps.push("alerts");
  if (input.biometricReady && !input.biometricChosen) steps.push("biometric");
  return steps;
}

export async function hasSignedInBefore(): Promise<boolean> {
  return Boolean(await readSecret(SEEN_KEY));
}

export async function markSignedIn(): Promise<void> {
  await writeSecret(SEEN_KEY, "1");
}

/** The phone can still show the system's "Allow notifications?" (never asked, not refused). */
export async function alertsUndecided(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    return !perm.granted && perm.canAskAgain !== false;
  } catch {
    return false;
  }
}

export async function biometricReady(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

/** Whether the person already chose (Settings, or the invite's "Use Face ID next time"). */
export async function biometricChosen(): Promise<boolean> {
  return (await readSecret(KEYS.biometric)) !== null;
}
