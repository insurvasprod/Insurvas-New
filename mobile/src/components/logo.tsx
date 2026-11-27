import { View } from "react-native";
import { SvgXml } from "react-native-svg";

import { ISOTYPE_ON_DARK } from "./isotype";

/**
 * The Insurvas isotype (BRAND.md), the same file the mockups use (`k.logo`). Board A1 puts it at 42px
 * inside a 64px olive (#0d4037) tile with 16px corners: `<Logo tile />`.
 */
export function Logo({ size = 26, tile = false }: { size?: number; tile?: boolean }) {
  // Plain SVG: isotype.ts already carries every colour inline and every gradient's own stops.
  const mark = <SvgXml xml={ISOTYPE_ON_DARK} width={size} height={size} />;
  if (!tile) return mark;
  const box = Math.round(size * (64 / 42));
  return (
    <View accessibilityRole="image" accessibilityLabel="Insurvas" style={{ width: box, height: box, borderRadius: Math.round(box / 4), backgroundColor: "#0d4037", alignItems: "center", justifyContent: "center" }}>
      {mark}
    </View>
  );
}
