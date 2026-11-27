import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

import { ICONS, type IconName } from "./icon-paths";

const SHAPES = { path: Path, circle: Circle, rect: Rect, line: Line, polyline: Polyline, polygon: Polygon, ellipse: Ellipse } as const;

/** The board's 24px stroke icons (docs/design/mobile-v1/kit.js), one set for both platforms. */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const parts = ICONS[name] as unknown as [keyof typeof SHAPES, Record<string, string>][];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {parts.map(([tag, attrs], i) => {
        const Shape = SHAPES[tag] as unknown as React.ComponentType<Record<string, string | number>>;
        return <Shape key={i} {...attrs} />;
      })}
    </Svg>
  );
}

export type { IconName };
