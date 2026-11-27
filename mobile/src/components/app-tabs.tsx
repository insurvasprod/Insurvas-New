import { NativeTabs } from "expo-router/native-tabs";
import type { ImageSourcePropType } from "react-native";

import { useTabs } from "@/lib/nav";
import { useAndroidKeyboardShown } from "@/lib/sheet-inset";
import { useProducerTabs } from "@/lib/tab-choice";
import { tabsFor, type TabKey } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

import { ALERT_BADGE, barBadgeTone, useTabBadges } from "./app-tabs-badges";

/**
 * The platform's own tab bar: iOS tab bar with SF Symbols, Android navigation bar drawing the board's
 * own icons (assets/images/tabs, rendered from kit.js and tinted by the bar) with every label showing,
 * as `.tabs-and` does. Which tabs show follows the role (lib/roles.ts). Badges (app-tabs-badges.ts) are gold for new
 * counts and the kit's red `.badge.alert` when the Inbox holds alerts that need attention; a tab's count is one line
 * in BADGE_COUNTS there, and a new tab is one entry in TAB_META (plus its TabKey and route).
 */
type Meta = { label: string; sf: { default: string; selected: string }; src: ImageSourcePropType };
export const TAB_META: Record<TabKey, Meta> = {
  index: { label: "Home", sf: { default: "house", selected: "house.fill" }, src: require("../../assets/images/tabs/home.png") },
  calls: { label: "Calls", sf: { default: "phone", selected: "phone.fill" }, src: require("../../assets/images/tabs/phone.png") },
  leads: { label: "Leads", sf: { default: "person.text.rectangle", selected: "person.text.rectangle.fill" }, src: require("../../assets/images/tabs/contact.png") },
  // Retention's tabs (board: Cases with the buoy, Book). The ladder tab is named apart from /cases,
  // which is the producer's pending cases.
  ladder: { label: "Cases", sf: { default: "lifepreserver", selected: "lifepreserver.fill" }, src: require("../../assets/images/tabs/buoy.png") },
  // Owner, manager and bookkeeper tabs (release 3): Team with people, Money with the wallet.
  teamtab: { label: "Team", sf: { default: "person.2", selected: "person.2.fill" }, src: require("../../assets/images/tabs/users.png") },
  moneytab: { label: "Money", sf: { default: "wallet.bifold", selected: "wallet.bifold.fill" }, src: require("../../assets/images/tabs/wallet.png") },
  policies: { label: "Book", sf: { default: "book", selected: "book.fill" }, src: require("../../assets/images/tabs/book.png") },
  inbox: { label: "Inbox", sf: { default: "tray", selected: "tray.fill" }, src: require("../../assets/images/tabs/inbox.png") },
  menu: { label: "Menu", sf: { default: "square.grid.2x2", selected: "square.grid.2x2.fill" }, src: require("../../assets/images/tabs/grid.png") },
};

/** A setter's Calls tab is the dialer (board B3: "Dialer", phone-out icon). */
const SETTER_CALLS: Meta = { label: "Dialer", sf: { default: "phone.arrow.up.right", selected: "phone.arrow.up.right.fill" }, src: require("../../assets/images/tabs/phoneOut.png") };

export function AppTabs() {
  const p = usePalette();
  const { me } = useSession();
  const badges = useTabBadges();
  const role = me?.memberRole ?? me?.role;
  const producerTabs = useProducerTabs();
  const visible = tabsFor(role, { producerTabs, features: me?.plan?.features, solo: me?.solo ?? false });
  // Kept for links opened outside a component (lib/nav.ts): a hidden tab is reached by its pushed twin.
  useTabs();
  const shown = new Set(visible);
  // The bar draws its triggers in the order they are declared: the role's own order first (a manager's Calls sits
  // where the owner's Money does, board B8), then the hidden ones.
  const order = [...visible, ...(Object.keys(TAB_META) as TabKey[]).filter((k) => !shown.has(k))];
  const alertBar = barBadgeTone(badges, visible) === "alert";
  // Android shrinks the window above the keyboard, which would lift the bar over a search field's
  // results; Material's bottom bar steps aside while typing instead.
  const typing = useAndroidKeyboardShown();
  return (
    <NativeTabs
      hidden={typing}
      backgroundColor={p.surf}
      indicatorColor={p.greenSoft}
      iconColor={{ default: p.muted, selected: p.greenInk }}
      labelStyle={{ default: { color: p.muted, fontSize: 12, fontWeight: "500" }, selected: { color: p.ink, fontSize: 12, fontWeight: "600" } }}
      labelVisibilityMode="labeled"
      badgeBackgroundColor={alertBar ? ALERT_BADGE.bg : p.gold}
      badgeTextColor={alertBar ? ALERT_BADGE.fg : p.onGold}
    >
      {order.map((key) => {
        const meta = key === "calls" && role === "setter" ? SETTER_CALLS : TAB_META[key];
        return (
          <NativeTabs.Trigger key={key} name={key} hidden={!shown.has(key)}>
            <NativeTabs.Trigger.Icon sf={meta.sf as never} src={meta.src} renderingMode="template" />
            <NativeTabs.Trigger.Label>{meta.label}</NativeTabs.Trigger.Label>
            {badges[key] ? <NativeTabs.Trigger.Badge>{badges[key].text}</NativeTabs.Trigger.Badge> : null}
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}
