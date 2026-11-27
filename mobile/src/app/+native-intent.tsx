import { resolveIntentPath } from "@/components/native/intents";
import { currentTabs } from "@/lib/links";

/**
 * Expo Router's hook for links from outside the app. Boards L1, L3 and L5: a widget tap, the icon's
 * long-press menu, Siri and Google send insurvas://serve-next and the like, which name no route; this
 * turns them into the screen they mean. Every other link goes through untouched.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return resolveIntentPath(path, Date.now(), currentTabs()) ?? path;
  } catch {
    // A link we can't read must never stop the app from opening.
    return path;
  }
}
