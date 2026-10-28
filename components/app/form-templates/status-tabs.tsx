"use client";

import { useRef, type KeyboardEvent } from "react";
import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTab<K extends string> = { key: K; label: string; status: { text: string; tone: "warn" | "good" | "calm" } };

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
  idPrefix: string;
  panelIdPrefix: string;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});

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

  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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
              "flex min-h-[72px] min-w-0 flex-col items-start gap-1 rounded-[12px] bg-[var(--surface)] text-left transition-colors",
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
}
