import { Linking, Share, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { Icon } from "@/components/icon";
import { RouteSheet } from "@/components/menu/route-sheet";
import { Button, F, TextLink } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { linkMail } from "@/lib/links";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J2 · Opens on a computer, a sheet over the Menu (h 520). A laptop-marked page never dead-ends:
 * it says what the page is for (the web's own blurb) and emails the exact link to the person's own
 * address (the phone's mail app, so they pick it up at their desk), or opens it in the phone's browser
 * anyway. Only Insurvas web paths are ever opened here.
 *
 * A path that is not an Insurvas web page (/app/…) is never swapped for another page: the sheet still says the
 * page works best on a computer but offers no link to email or open, since there is no address to send.
 *
 * The board's "Put it in my bell on the web" needs a server route that writes a bell row for oneself;
 * there is none (reported), so the button is not drawn.
 */
export default function Computer() {
  const p = usePalette();
  const { me } = useSession();
  const { path, title, why, saved } = useLocalSearchParams<{ path?: string; title?: string; why?: string; saved?: string }>();
  // An application saved as a draft on the phone (Review / Sign): where to continue it on the computer.
  const isSaved = saved === "1";
  const safe = typeof path === "string" && path.startsWith("/app/") ? path : null;
  const url = safe ? `${API_URL}${safe}` : null;
  const name = typeof title === "string" && title ? title : "This page";
  const blurb = typeof why === "string" && why ? why : "It needs a wide screen, or it changes things for the whole agency.";
  const email = () => { if (url) void Linking.openURL(linkMail(me?.user.email, name, url)).catch(() => Share.share({ message: url, url })); };
  return (
    <RouteSheet minHeight={520} testID="computer-sheet">
      <View style={{ paddingHorizontal: 16, alignItems: "flex-start", gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}><Icon name={isSaved ? "checkC" : "laptop"} size={28} color={p.greenInk} /></View>
        <View>
          <Text testID="computer-title" accessibilityRole="header" style={{ fontFamily: F.db, fontSize: 24, lineHeight: 29, letterSpacing: -0.48, color: p.ink }}>{isSaved ? name : `${name} works best on a computer`}</Text>
          <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted }}>{isSaved ? blurb : `${blurb} A phone screen hides most of that.`}</Text>
        </View>
        {url ? (
          <>
            <View style={{ alignSelf: "stretch", gap: 10 }}>
              <Button testID="computer-send" label="Email me the link" icon="mail" onPress={email} />
            </View>
            <View style={{ alignSelf: "center" }}>
              <TextLink label="Open in this phone’s browser anyway" onPress={() => void WebBrowser.openBrowserAsync(url)} />
            </View>
          </>
        ) : null}
      </View>
    </RouteSheet>
  );
}
