// Board L5 · Google Assistant App Actions on Android ("Hey Google, open next callback in Insurvas").
// Adds res/xml/shortcuts.xml with one capability, actions.intent.OPEN_APP_FEATURE, whose spoken feature name lands on
// insurvas://open?feature=<words>; the app maps the words to its shortcut (src/components/native/intents.ts
// spokenFeature) and checks the role there. No static shortcuts are declared: the long-press menu is set per person
// from the app (expo-quick-actions), so an owner on Team · Money is never offered Calls.
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const XML = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <capability android:name="actions.intent.OPEN_APP_FEATURE">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="${pkg}" android:targetClass="${pkg}.MainActivity">
      <url-template android:value="insurvas://open{?feature}" />
      <parameter android:name="feature" android:key="feature" />
    </intent>
  </capability>
</shortcuts>
`;

function withShortcutsXml(config) {
  return withDangerousMod(config, ["android", async (cfg) => {
    const pkg = cfg.android?.package;
    if (!pkg) throw new Error("with-android-app-actions: expo.android.package is required");
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "shortcuts.xml"), XML(pkg));
    return cfg;
  }]);
}

function withShortcutsMetaData(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity["meta-data"] = (activity["meta-data"] ?? []).filter((m) => m.$["android:name"] !== "android.app.shortcuts");
    activity["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/shortcuts" } });
    return cfg;
  });
}

module.exports = function withAndroidAppActions(config) {
  return withShortcutsMetaData(withShortcutsXml(config));
};
