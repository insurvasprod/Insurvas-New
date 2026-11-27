import { useCallback, useEffect, useMemo } from "react";
import { router } from "expo-router";

import { appHrefFor, currentTabs, reachable, rememberTabs, type AppHref } from "./links";
import { tabsFor } from "./roles";
import { useSession } from "./session";
import { useProducerTabs } from "./tab-choice";

/**
 * Opening a screen the way this person's tab bar allows. An owner on Team · Money has no Calls or Leads
 * tab, and a hidden tab falls back to Home, so every push to /calls or /leads goes through here and lands
 * on the pushed twin instead (lib/links.ts `reachable`).
 */
export function useTabs(): string[] {
  const { me } = useSession();
  const producerTabs = useProducerTabs();
  const features = me?.plan?.features;
  const solo = me?.solo ?? false;
  const tabs = useMemo(() => tabsFor(me?.memberRole ?? me?.role, { producerTabs, features, solo }), [me?.memberRole, me?.role, producerTabs, features, solo]);
  useEffect(() => { rememberTabs(tabs); }, [tabs]);
  return tabs;
}

export { currentTabs };

export function useNav() {
  const tabs = useTabs();
  const go = useCallback((href: AppHref) => router.push(reachable(href, tabs) as never), [tabs]);
  const swap = useCallback((href: AppHref) => router.replace(reachable(href, tabs) as never), [tabs]);
  const hrefFor = useCallback((webPath: string | null | undefined) => appHrefFor(webPath, tabs), [tabs]);
  return { tabs, go, swap, hrefFor };
}
