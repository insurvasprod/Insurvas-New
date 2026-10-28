"use client";

import { DetailPanel, type DetailPanelProps } from "@/components/ui/detail-panel";

/**
 * The sheet (UI-CONSISTENCY §11, foundation v3): a record, or a form too long for a dialog, sliding
 * over the page from the right at 420px, with its actions in a footer that stays put. It is the
 * overlay mode of `DetailPanel`, named for what it is, so a page never builds its own drawer.
 * Render it only while it is open.
 */
export function Sheet(props: Omit<DetailPanelProps, "mode" | "splitFrom">) {
  return <DetailPanel mode="overlay" {...props} />;
}
