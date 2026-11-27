import { Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { groupsFor, initialsOf, type WebPage } from "@/components/menu/pages";
import { useBarMarks } from "@/components/states/states";
import { Avatar, Card, F, Group, Header, Row, Screen } from "@/components/ui";
import { useCounts } from "@/lib/counts";
import { appHrefFor } from "@/lib/links";
import { useNav } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/roles";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J1 · Menu. The web sidebar, in its groups and order, filtered by role like the web menu (the rows are
 * the server's `menuKeys`). Pages the phone has open here, with a chevron; pages built for a big screen carry
 * a laptop mark and open the hand-off (J2). Where the phone screen depends on the role (the Commission
 * ledger), the role decides. Gold numbers are the web's own menu counts (/api/app/nav/counts).
 */
export default function Menu() {
  const p = usePalette();
  const { me } = useSession();
  const counts = useCounts();
  const marks = useBarMarks();
  const navCounts = (counts.nav?.counts ?? {}) as Record<string, number | undefined>;
  const role = me?.memberRole ?? me?.role ?? "";
  const who = me?.user.name ?? me?.user.email ?? "";
  const { tabs } = useNav();
  const hrefFor = (path: string) => appHrefFor(path, tabs, role);
  const groups = groupsFor([me?.role, me?.memberRole, me?.agencyTitle, ...(me?.roles ?? [])], { features: me?.plan?.features ?? null, tabs, menuKeys: me?.menuKeys ?? null, baseRole: me?.role ?? null });

  function open(pg: WebPage) {
    const href = hrefFor(pg.path);
    if (href) router.push(href as never);
    else router.push({ pathname: "/computer", params: { path: pg.path, title: pg.label, why: pg.why ?? "" } });
  }

  function row(pg: WebPage, i: number) {
    const desk = !hrefFor(pg.path);
    const n = navCounts[pg.key] ?? 0;
    return (
      <Row key={pg.key} testID={`menu-${pg.key}`} first={i === 0} icon={pg.icon} title={pg.label} chevron={!desk} onPress={() => open(pg)}
        chip={(n > 0 || desk) ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {n > 0 ? <Text style={{ fontFamily: F.s, fontSize: 14, color: p.goldInk, fontVariant: ["tabular-nums"] }}>{n.toLocaleString()}</Text> : null}
            {desk ? <View accessibilityLabel="Opens on a computer"><Icon name="laptop" size={18} color={p.faint} /></View> : null}
          </View>
        ) : undefined} />
    );
  }

  return (
    <Screen header={<Header title="Menu" actions={[...marks, { icon: "search", label: "Search everything", onPress: () => router.push("/search") }]} />}>
      <View style={{ paddingHorizontal: 16 }}>
        <Card onPress={() => router.push("/settings")} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Avatar initials={initialsOf(who)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{who}</Text>
            <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{[ROLE_LABELS[role] ?? role, me?.tenant.name].filter(Boolean).join(" · ")}</Text>
          </View>
          <Icon name="chevR" size={18} color={p.faint} />
        </Card>
      </View>

      {groups.map((g) => <Group key={g.title} title={g.title}>{g.pages.map(row)}</Group>)}

      <Group>
        <Row first testID="menu-settings" icon="settings" title="Settings" onPress={() => router.push("/settings")} />
        <Row testID="menu-help" icon="globe" title="Help and guides" onPress={() => router.push("/menu/help" as never)} />
      </Group>
    </Screen>
  );
}
