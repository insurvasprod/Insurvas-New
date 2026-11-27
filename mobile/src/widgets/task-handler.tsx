import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { readSnapshot } from "./data";
import { renderWidget } from "./widgets";

/**
 * The widgets' background task (added, the 30-minute update, resized): draw the last snapshot the app kept. Taps open
 * insurvas:// links themselves (OPEN_URI), so nothing is handled here on a click.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetAction === "WIDGET_DELETED" || props.widgetAction === "WIDGET_CLICK") return;
  props.renderWidget(renderWidget(props.widgetInfo.widgetName, await readSnapshot()));
}
