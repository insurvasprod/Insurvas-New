"use client";

import { useState } from "react";

/**
 * Which way a step-by-step view last moved, for its keyed step container's `data-enter` (docs/design/UI-CONSISTENCY.md
 * § Motion): a later step in `order` is `forward` (slides in from the right), an earlier one `back` (from the left).
 * The first step drawn is `area` (a short rise). Derived from the key during render, so it needs no effect.
 */
export function useStepDirection<K>(key: K, order: readonly K[]): "forward" | "back" | "area" {
  const [seen, setSeen] = useState<{ key: K; enter: "forward" | "back" | "area" }>({ key, enter: "area" });
  if (seen.key !== key) {
    const enter = order.indexOf(key) < order.indexOf(seen.key) ? "back" : "forward";
    setSeen({ key, enter });
    return enter;
  }
  return seen.enter;
}
