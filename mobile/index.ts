// The app's entry: Expo Router's, plus the Android home-screen widgets' background task (board L1). The widget module
// exists only in a development or store build, so it is required lazily behind that check (never in Expo Go or on web).
import "expo-router/entry";

import { widgetsAvailable } from "./src/widgets/available";

if (widgetsAvailable) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerWidgetTaskHandler } = require("react-native-android-widget") as typeof import("react-native-android-widget");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { widgetTaskHandler } = require("./src/widgets/task-handler") as typeof import("./src/widgets/task-handler");
  registerWidgetTaskHandler(widgetTaskHandler);
}
