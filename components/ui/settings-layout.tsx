"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SettingsSection = { key: string; label: string; icon?: ReactNode };

/**
 * A settings surface: sections on the left, the open one in the middle, health on the right.
 *
 * The section list is navigation, not a tab strip — these pages have eight or more panels and a
 * horizontal strip either scrolls or wraps into two rows, both of which hide where you are. On
 * mobile it becomes a scrollable row of chips, which is the one place a strip works: few enough
 * items visible, and the page is one column anyway.
 */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  rail,
  children,
}: {
  sections: SettingsSection[];
  active: string;
  onSelect: (key: string) => void;
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        rail
          ? "xl:grid-cols-[240px_minmax(0,1fr)_300px]"
          : "lg:grid-cols-[240px_minmax(0,1fr)]"
      )}
    >
      <nav
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-2 lg:flex-col lg:overflow-visible"
      >
        {sections.map((section) => {
          const isActive = section.key === active;
          return (
            <button
              key={section.key}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelect(section.key)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive
                  ? "bg-[var(--soft-orange-surface)] font-semibold text-[var(--accent-ink)] shadow-[inset_2px_0_0_var(--primary)]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {section.icon}
              {section.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-4">{children}</div>

      {rail && <aside className="space-y-4 xl:sticky xl:top-[calc(var(--top-bar-h)+1.5rem)]">{rail}</aside>}
    </div>
  );
}

/**
 * The bar that appears when a settings form is dirty.
 *
 * Sticky at the bottom rather than at the top of the panel, because on a long form the save button
 * has to be reachable from wherever the reader stopped typing. Discard is secondary and sits left
 * of save; nothing here is destructive enough for the red one.
 */
export function SettingsSaveBar({
  note,
  children,
  visible = true,
}: {
  note?: string;
  children: ReactNode;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:-mx-6 sm:px-6">
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
