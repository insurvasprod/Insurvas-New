import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

import { Group, Header, Row, Screen, SearchBox } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { helpGroups } from "@/lib/help-topics";
import { lastScreen } from "@/lib/last-screen";

/**
 * Board J4 · Help and guides: the web's /app/docs inside the Menu tab. The search opens the guides' own
 * search; "For this screen" is the guides for the screen you were on (lib/help-topics), "Popular" the
 * everyday ones, each a real guide page (/app/docs/<slug>). Contact support writes to the support
 * address the web uses, with the app version and phone attached.
 */
const SUPPORT = "support@insurvas.com";
const version = (Constants.expoConfig?.version ?? "1.0.0").replace(/\.0$/, "");
// Board J4's footer: "App 1.0 (142)" — the build number, when the app's config carries one.
const build = Platform.OS === "android" ? Constants.expoConfig?.android?.versionCode : Constants.expoConfig?.ios?.buildNumber;
const appLine = `App ${version}${build != null && String(build) ? ` (${build})` : ""}`;
const osVersion = Platform.OS === "android" ? String((Platform.constants as { Release?: string }).Release ?? Platform.Version) : String(Platform.Version);
const phone = `${Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} ${osVersion}`;

export default function Help() {
  const from = lastScreen();
  const { screen, popular } = helpGroups(from.pathname, from.part);
  const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);
  const contact = () => {
    const body = `\n\n—\n${appLine} · ${phone}${screen ? ` · ${screen.name}` : ""}`;
    void Linking.openURL(`mailto:${SUPPORT}?subject=${encodeURIComponent("Help with the Insurvas app")}&body=${encodeURIComponent(body)}`).catch(() => undefined);
  };
  return (
    <Screen header={<Header title="Help" large below={<SearchBox testID="help-search" placeholder="Search the guides" onPress={() => open("/app/docs")} />} />}>
      {screen ? (
        <Group title={`For this screen · ${screen.name}`}>
          {screen.guides.map((g, i) => <Row key={g.slug} testID={`guide-${g.slug}`} first={i === 0} icon="help" title={g.title} onPress={() => open(`/app/docs/${g.slug}`)} />)}
        </Group>
      ) : null}
      <Group title="Popular">
        {popular.map((g, i) => <Row key={g.slug} testID={`guide-${g.slug}`} first={i === 0} icon="file" iconTone="plain" title={g.title} onPress={() => open(`/app/docs/${g.slug}`)} />)}
      </Group>
      <Group footer={`${appLine} · ${phone}`}>
        <Row first testID="help-support" icon="msg" title="Contact support" meta={SUPPORT} onPress={contact} />
      </Group>
    </Screen>
  );
}
