"use client";

import { useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert } from "lucide-react";

import { useSettingsRailSlots } from "@/components/ui/settings-rail-context";
import type { TabStatus } from "@/lib/users/profileStatus";
import { cn } from "@/lib/utils";

/**
 * Settings › My profile's tabs (redesign 2026-10-27, layout B): a card per tab that says what needs
 * you, so the page answers "is anything wrong?" before anyone opens a tab.
 *
 * The selected card is marked by a 2px ink border, not the brand green — green on white is 1.9:1,
 * under the 3:1 a state indicator needs. A tab list in the ARIA sense: one tab in the Tab order,
 * arrows, Home and End move between them.
 */
export type StatusTab<K extends string> = { key: K; label: string; status: TabStatus };

const TONE = {
  warn: "text-[var(--warning-ink)]",
  good: "text-[var(--success-ink)]",
  calm: "text-[var(--muted)]",
} as const;

export function StatusTabs<K extends string>({ label, tabs, value, onChange, idPrefix, panelIdPrefix }: {
  label: string;
  tabs: ReadonlyArray<StatusTab<K>>;
  value: K;
  onChange: (key: K) => void;
  /** Each tab's id is `${idPrefix}-${key}`, for the panel's aria-labelledby. */
  idPrefix: string;
  /** Each tab's panel id is `${panelIdPrefix}-${key}`. */
  panelIdPrefix: string;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const rail = useSettingsRailSlots();

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const key = tabs[next].key;
    onChange(key);
    refs.current[key]?.focus();
  }

  const tabList = (
    <div role="tablist" aria-label={label} aria-orientation={rail?.tabs ? "vertical" : undefined} className={rail?.tabs ? "flex min-w-0 flex-col gap-1.5" : "grid grid-cols-2 gap-2.5 lg:grid-cols-4"}>
      {tabs.map((tab, index) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => move(event, index)}
            ref={(node) => { refs.current[tab.key] = node; }}
            id={`${idPrefix}-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${panelIdPrefix}-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1 rounded-[10px] bg-[var(--surface)] text-left transition-colors",
              rail?.tabs ? "min-h-0 w-full py-2.5" : "min-h-[72px]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
              selected ? "border-2 border-[var(--ink)] px-[13px] py-[11px]" : "border border-[var(--border)] px-3.5 py-3 hover:border-[var(--border-strong)]",
            )}
          >
            <span className="text-sm font-bold text-[var(--ink)]">{tab.label}</span>
            <span className={cn("inline-flex min-w-0 items-start gap-1.5 text-xs leading-[1.4] font-semibold", TONE[tab.status.tone])}>
              {tab.status.tone === "warn" && <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />}
              {tab.status.tone === "good" && <Check aria-hidden="true" className="mt-px size-3.5 shrink-0" />}
              <span>{tab.status.text}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
  return rail?.tabs ? createPortal(tabList, rail.tabs) : tabList;
}
