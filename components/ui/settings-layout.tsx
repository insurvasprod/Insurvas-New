"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";

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
  searchable = false,
  collapsible = false,
  fitHeight = false,
  children,
}: {
  sections: SettingsSection[];
  active: string;
  onSelect: (key: string) => void;
  rail?: ReactNode;
  searchable?: boolean;
  collapsible?: boolean;
  fitHeight?: boolean;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    if (collapsible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the user's menu preference once
      try { setFolded(window.localStorage.getItem("insurvas.settings.menuFolded") === "1"); } catch { /* storage blocked: start open */ }
    }
    return () => media.removeEventListener("change", sync);
  }, [collapsible]);
  const foldedRail = collapsible && folded && desktop;
  const visibleSections = searchable && query.trim()
    ? sections.filter((section) => section.label.toLowerCase().includes(query.trim().toLowerCase()))
    : sections;
  const toggleFold = (next: boolean) => {
    setFolded(next);
    try { window.localStorage.setItem("insurvas.settings.menuFolded", next ? "1" : "0"); } catch { /* storage blocked: the menu still works */ }
  };

  return (
    <div
      className={cn(
        "grid min-w-0 gap-4",
        fitHeight && "min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]",
        rail
          ? "xl:grid-cols-[240px_minmax(0,1fr)_300px]"
          : foldedRail
            ? "lg:grid-cols-[52px_minmax(0,1fr)]"
            : "lg:grid-cols-[240px_minmax(0,1fr)]"
      )}
    >
      <nav
        aria-label="Settings sections"
        className={cn(
          "flex min-w-0 flex-col gap-1",
          fitHeight && "lg:h-full lg:min-h-0",
          foldedRail && "items-center"
        )}
      >
        {(searchable || collapsible) && (
          <div className={cn("mb-1 flex min-w-0 items-center gap-1.5", foldedRail && "flex-col")}>
            {foldedRail ? (
              <>
                <button type="button" onClick={() => toggleFold(false)} aria-label="Show the settings menu" title="Show menu" className="inline-flex size-9 items-center justify-center rounded-[8px] border-0 bg-transparent text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]">
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                </button>
                {searchable && <button type="button" onClick={() => { toggleFold(false); requestAnimationFrame(() => searchRef.current?.focus()); }} aria-label="Search settings" title="Search settings" className="inline-flex size-9 items-center justify-center rounded-[8px] border-0 bg-transparent text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]">
                  <Search className="size-4" aria-hidden="true" />
                </button>}
              </>
            ) : (
              searchable && <label className="relative block min-w-0 flex-1">
                <span className="sr-only">Search settings</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" className="h-9 w-full rounded-[8px] border border-input bg-background pr-9 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                {query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear settings search" className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-transparent text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"><X className="size-3.5" aria-hidden="true" /></button>}
              </label>
            )}
            {collapsible && !foldedRail && <button type="button" onClick={() => toggleFold(true)} aria-label="Hide the settings menu" title="Hide menu" className="hidden size-9 shrink-0 items-center justify-center rounded-[8px] border-0 bg-transparent text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] lg:inline-flex"><PanelLeftClose className="size-4" aria-hidden="true" /></button>}
          </div>
        )}
        {!visibleSections.length ? (
          <p role="status" className="m-0 px-2.5 py-3 text-sm text-muted-foreground">Nothing in Settings matches “{query.trim()}”.</p>
        ) : visibleSections.map((section) => {
          const isActive = section.key === active;
          return (
            <button
              key={section.key}
              type="button"
              aria-current={isActive ? "page" : undefined}
              aria-label={foldedRail ? section.label : undefined}
              title={foldedRail ? section.label : undefined}
              onClick={() => onSelect(section.key)}
              className={cn(
                "flex min-h-10 min-w-0 shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-sm font-medium transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive
                  ? "bg-[var(--primary-soft)] font-semibold text-[var(--accent-ink)]"
                  : "text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground",
                foldedRail && "w-10 justify-center px-0"
              )}
            >
              {section.icon && <span className="grid size-5 shrink-0 place-items-center">{section.icon}</span>}
              {!foldedRail && <span className="min-w-0 truncate">{section.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className={cn("min-w-0 space-y-4", fitHeight && "lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1.5")}>{children}</div>

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
    // Settings R3 (2026-10-29): a solid bar floating 16px above the window's bottom edge. The see-through
    // band it replaced let the page's text run under its buttons, so it read as part of the page.
    <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-20 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--shadow-overlay)]">
      {note && <p className="m-0 flex items-center gap-2 text-sm text-[var(--body)]"><span aria-hidden="true" className="size-2 rounded-full bg-[var(--warning)]" />{note}</p>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
