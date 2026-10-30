"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** From this width the side panel sits in the row beside the form (DetailPanel splitFrom="xl"). */
export const SIDE_BY_SIDE = "(min-width: 1280px)";

/**
 * Below 1280px the side panel is a fixed sheet, but the settings frame is an @container (layout
 * containment), which pins any fixed child to the frame instead of the screen. There the panel is
 * drawn on <body>; beside the form it stays in the row.
 */
export function SidePanelHost({ children }: { children: ReactNode }) {
  const [inRow, setInRow] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(SIDE_BY_SIDE);
    const sync = () => setInRow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return inRow ? <>{children}</> : createPortal(children, document.body);
}
