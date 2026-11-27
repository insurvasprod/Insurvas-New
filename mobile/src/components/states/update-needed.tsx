import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { Button, F, IOS } from "@/components/ui";
import { usePalette } from "@/theme/use-palette";

/**
 * Board M8 · Update needed: when the server refuses this version of the app (lib/answer-state
 * `needsUpdate`), the whole app is this state instead of breaking. The button opens the store page:
 * Google Play by the app's package; on iOS the App Store search until the app has its store id.
 */
export function storeUrl(os: string = Platform.OS): string {
  if (os === "android") return `market://details?id=${Constants.expoConfig?.android?.package ?? "com.insurvas.app"}`;
  return "https://apps.apple.com/search?term=Insurvas";
}

export function UpdateNeeded() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const open = () => {
    const url = storeUrl();
    void Linking.openURL(url).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${Constants.expoConfig?.android?.package ?? "com.insurvas.app"}`).catch(() => undefined));
  };
  return (
    <View testID="update-needed" style={[StyleSheet.absoluteFill, { backgroundColor: p.canvas, paddingTop: insets.top + 150, paddingHorizontal: 30, alignItems: "center", gap: 10 }]}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: p.surf2, alignItems: "center", justifyContent: "center" }}>
        <Icon name="download" size={30} color={p.greenInk} />
      </View>
      <Text accessibilityRole="header" style={{ marginTop: 6, fontFamily: F.db, fontSize: 20, lineHeight: 25, color: p.ink, textAlign: "center" }}>Update Insurvas to keep going</Text>
      <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted, textAlign: "center" }}>
        This version can’t talk to the latest Insurvas. The update takes about a minute; nothing you saved is lost.
      </Text>
      <View style={{ width: 240, marginTop: 14 }}>
        <Button testID="update-open-store" label={IOS ? "Open the App Store" : "Open Google Play"} onPress={open} />
      </View>
    </View>
  );
}
