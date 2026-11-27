import { createContext, use, useState, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { usePalette } from "@/theme/use-palette";

/**
 * Board L6 · Tablet. On an iPad or an Android tablet the app shows two panes, like the web: the list
 * on the left, the record on the right. A phone (and a phone held sideways) keeps one pane, so nothing
 * changes there. Which record is open lives here, not in the URL, because the list stays the screen
 * the person is on; the record beside it is a preview they can swap with one tap.
 */

/** 720dp: an iPad mini held upright is 744, a large phone held sideways about 430 tall by 930 wide. */
export const WIDE_AT = 720;

/** True when the window is wide enough for two panes. Re-renders on rotation and split screen. */
export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_AT;
}

/**
 * The list pane's width. Board L6 draws it narrow at phone scale (130 of the 351 points beside an 8-point gap, 37%);
 * the same share of a tablet, never under 280 (a phone's narrowest row, so a chip never wraps) nor over 380.
 */
export function listWidth(window: number): number {
  return Math.round(Math.min(380, Math.max(280, window * 0.36)));
}

type SplitValue = {
  /** Two panes are showing. */
  wide: boolean;
  /** The record open on the right, or null. */
  selected: string | null;
  show: (id: string) => void;
  clear: () => void;
};

const NONE: SplitValue = { wide: false, selected: null, show: () => undefined, clear: () => undefined };
const SplitContext = createContext<SplitValue>(NONE);

/** The pane state for a list inside a SplitView. Outside one (a phone screen, a test), wide is false. */
export function useSplit(): SplitValue {
  return use(SplitContext);
}

/**
 * Two panes when the window is wide, the list alone when it isn't. `detail` draws the record for the
 * selected id; `placeholder` fills the right pane before anything is picked.
 */
export function SplitView({ children, detail, placeholder, testID }: {
  children: ReactNode;
  detail: (id: string, close: () => void) => ReactNode;
  placeholder: ReactNode;
  testID?: string;
}) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  const [selected, setSelected] = useState<string | null>(null);
  const clear = () => setSelected(null);
  const value: SplitValue = { wide, selected, show: setSelected, clear };

  // One pane: the list is the screen, exactly as before; the provider only says "not wide".
  if (!wide) return <SplitContext value={value}>{children}</SplitContext>;

  return (
    <SplitContext value={value}>
      <View testID={testID} style={{ flex: 1, flexDirection: "row", backgroundColor: p.canvas }}>
        <View testID="split-list" style={{ width: listWidth(width), borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.line2 }}>
          {children}
        </View>
        {/* key: a new record starts fresh (its tab, its note box), never with the last one's state. */}
        <View testID="split-detail" key={selected ?? "none"} style={{ flex: 1, backgroundColor: p.canvas }}>
          {selected ? detail(selected, clear) : placeholder}
        </View>
      </View>
    </SplitContext>
  );
}
