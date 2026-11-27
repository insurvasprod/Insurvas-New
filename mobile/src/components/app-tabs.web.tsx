import { Tabs } from "expo-router/js-tabs";

import { ALERT_BADGE, useTabBadges } from "./app-tabs-badges";
import { Icon, type IconName } from "./icon";
import { tabsFor, type TabKey } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { useProducerTabs } from "@/lib/tab-choice";
import { usePalette } from "@/theme/use-palette";

/** The web preview (development only): the JavaScript tab bar, same tabs and badges as the phones (each badge its own colour). */
const META: Record<TabKey, { label: string; icon: IconName }> = {
  index: { label: "Home", icon: "home" },
  calls: { label: "Calls", icon: "phone" },
  leads: { label: "Leads", icon: "users" },
  ladder: { label: "Cases", icon: "buoy" },
  teamtab: { label: "Team", icon: "users" },
  moneytab: { label: "Money", icon: "wallet" },
  policies: { label: "Book", icon: "book" },
  inbox: { label: "Inbox", icon: "inbox" },
  menu: { label: "Menu", icon: "grid" },
};

export function AppTabs() {
  const p = usePalette();
  const { me } = useSession();
  const badges = useTabBadges();
  const producerTabs = useProducerTabs();
  const visible = tabsFor(me?.memberRole ?? me?.role, { producerTabs, features: me?.plan?.features, solo: me?.solo ?? false });
  const shown = new Set(visible);
  const order = [...visible, ...(Object.keys(META) as TabKey[]).filter((k) => !shown.has(k))];
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: p.greenInk, tabBarInactiveTintColor: p.muted, tabBarStyle: { backgroundColor: p.bar, borderTopColor: p.line }, tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 11 }, tabBarBadgeStyle: { backgroundColor: p.gold, color: p.onGold } }}>
      {order.map((key) => (
        <Tabs.Screen key={key} name={key} options={{
          title: META[key].label,
          href: shown.has(key) ? undefined : null,
          tabBarBadge: badges[key]?.text,
          ...(badges[key]?.tone === "alert" ? { tabBarBadgeStyle: { backgroundColor: ALERT_BADGE.bg, color: ALERT_BADGE.fg } } : {}),
          tabBarIcon: ({ focused }) => <Icon name={META[key].icon} size={22} color={focused ? p.greenInk : p.muted} />,
        }} />
      ))}
    </Tabs>
  );
}
