import { useEffect } from "react";
import { AppState } from "react-native";

import { useSession } from "@/lib/session";
import { useProducerTabs } from "@/lib/tab-choice";

import { widgetsAvailable } from "./available";
import { collectSnapshot, saveSnapshot } from "./data";
import { ONGOING_ID } from "@/components/native/ongoing-call";
import type { WidgetSnapshot } from "@/components/native/widget-snapshot";

const EVERY_MS = 5 * 60_000;

/** Redraw both widgets from a snapshot (null: the signed-out card). Never throws. */
async function redraw(snapshot: WidgetSnapshot | null): Promise<void> {
  if (!widgetsAvailable) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requestWidgetUpdate } = require("react-native-android-widget") as typeof import("react-native-android-widget");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderWidget, WIDGET_NAMES } = require("./widgets") as typeof import("./widgets");
    await Promise.all(Object.values(WIDGET_NAMES).map((widgetName) => requestWidgetUpdate({ widgetName, renderWidget: () => renderWidget(widgetName, snapshot) })));
  } catch {
    // A widget that can't be drawn is never the app's failure.
  }
}

/** Calls `then` for every push this phone receives while the app runs; returns the unsubscribe. Never throws. */
function onPush(then: () => void): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require("expo-notifications") as typeof import("expo-notifications");
    // The ongoing-call notification is the app's own, not news from the server.
    const sub = N.addNotificationReceivedListener((n) => { if (n.request.identifier !== ONGOING_ID) then(); });
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}

/** Ask the launcher to place a widget (Android's own "Add to home screen" card). False where it can't. */
export async function pinWidget(name: "Today" | "AgencyMonth"): Promise<boolean> {
  if (!widgetsAvailable) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requestPinWidget } = require("react-native-android-widget") as typeof import("react-native-android-widget");
    return await requestPinWidget({ widgetName: name });
  } catch {
    return false;
  }
}

/**
 * Board L1: "They refresh with push, not by polling." Keeps the home-screen widgets current from the app: signed in,
 * it rebuilds the snapshot the moment a push arrives (a transfer, a callback due, a case change — whatever moved the
 * day), and when the app opens or comes back (at most every five minutes). Nothing polls the server on a timer, and
 * the widget itself never calls it. Signing out clears the snapshot, so the next person sees nothing of the last.
 *
 * A push that lands while the app is closed redraws the widget the next time the app opens: waking the app for it in
 * the background needs expo-task-manager (a new native module, so a new development build) and background remote
 * notifications turned on in app.json.
 */
export function useWidgetSync(): void {
  const { status, me, api } = useSession();
  const userId = me?.user.id ?? null;
  const role = me?.role ?? null;
  const memberRole = me?.memberRole ?? null;
  const features = me?.plan?.features;
  const solo = me?.solo ?? false;
  const producerTabs = useProducerTabs();
  useEffect(() => {
    if (!widgetsAvailable) return;
    if (status === "signedOut") { void saveSnapshot(null).then(() => redraw(null)); return; }
    if (status !== "signedIn" || !userId || !role) return;
    let last = 0;
    let live = true;
    const run = async (force = false) => {
      if (!force && Date.now() - last < EVERY_MS) return;
      last = Date.now();
      try {
        const snapshot = await collectSnapshot(api, { userId, role, memberRole }, new Date(), { producerTabs, features, solo });
        if (!live) return;
        await saveSnapshot(snapshot);
        await redraw(snapshot);
      } catch {
        last = 0;
      }
    };
    void run();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void run(); });
    const pushed = onPush(() => void run(true));
    return () => { live = false; sub.remove(); pushed(); };
  }, [status, userId, role, memberRole, producerTabs, features, solo, api]);
}
