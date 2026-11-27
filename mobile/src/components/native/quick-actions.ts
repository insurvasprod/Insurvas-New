import { useEffect } from "react";
import { requireOptionalNativeModule } from "expo-modules-core";

import { useSession } from "@/lib/session";
import { useProducerTabs } from "@/lib/tab-choice";

import { quickActionItems } from "./intents";

/**
 * Board L3 · the app icon's long-press menu, from expo-quick-actions. The menu is this person's (their role and the
 * tabs they see), set after sign-in and emptied on sign-out; a tap routes to the screen in `params.href`. Expo Go and
 * the web have no such module, so it is loaded only where the native side exists.
 */
const native = requireOptionalNativeModule("ExpoQuickActions") != null;

type QuickActionsModule = typeof import("expo-quick-actions");
type RouterModule = typeof import("expo-quick-actions/router");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QA: QuickActionsModule | null = native ? (require("expo-quick-actions") as QuickActionsModule) : null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routing: RouterModule["useQuickActionRouting"] = native ? (require("expo-quick-actions/router") as RouterModule).useQuickActionRouting : () => undefined;

/** In the signed-in tabs layout (a sub-layout, as useQuickActionRouting requires): route a tap, keep the menu current. */
export function useQuickActionsMenu(): void {
  routing();
  const { me } = useSession();
  const producerTabs = useProducerTabs();
  const role = me?.memberRole ?? me?.role ?? null;
  const features = me?.plan?.features;
  const solo = me?.solo ?? false;
  useEffect(() => {
    if (!QA) return;
    void QA.setItems(quickActionItems(role, Date.now(), { producerTabs, features, solo })).catch(() => undefined);
  }, [role, producerTabs, features, solo]);
}

/** Signed out: the menu is emptied, so it never offers one person's shortcuts to the next. */
export function clearQuickActions(): void {
  if (QA) void QA.setItems([]).catch(() => undefined);
}
