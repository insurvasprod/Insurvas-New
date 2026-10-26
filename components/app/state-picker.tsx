"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

import { authControl } from "@/components/app/auth-card";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

/**
 * A US state, picked by typing (2026-10-26, owner: "fix the dropdown"). The native select drew its
 * list with the browser's own white surface, so on the dark theme the names were near-invisible and
 * fifty of them had to be scrolled. This is a combobox: type "tex" or "TX" and Enter; arrows move;
 * Escape closes; the list follows the theme. The value is the two-letter code, as the select's was.
 */
export function StatePicker({ value, onChange, id, describedBy }: { value: string; onChange: (code: string) => void; id?: string; describedBy?: string }) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-state`;
  const listId = `${autoId}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const chosen = US_STATES.find(([code]) => code === value)?.[1] ?? "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return US_STATES;
    return US_STATES.filter(([code, name]) => code.toLowerCase() === q || name.toLowerCase().startsWith(q) || name.toLowerCase().includes(` ${q}`));
  }, [query]);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function move(next: number) {
    const index = Math.max(0, Math.min(matches.length - 1, next));
    setActive(index);
    listRef.current?.querySelectorAll("li")[index]?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); if (!open) setOpen(true); else move(active + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(active - 1); }
    else if (event.key === "Enter" && open && matches[active]) { event.preventDefault(); pick(matches[active][0]); }
    else if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); setQuery(""); }
  }

  return (
    <div className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active][0]}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Type a state: Texas, Florida…"
        className={cn(authControl, "pr-9")}
        value={open ? query : chosen}
        onFocus={() => { setOpen(true); setQuery(""); setActive(Math.max(0, US_STATES.findIndex(([code]) => code === value))); }}
        onBlur={() => window.setTimeout(() => { setOpen(false); setQuery(""); }, 120)}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-[26px] size-4 text-muted-foreground" />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="States"
          className="absolute inset-x-0 top-full z-20 m-0 mt-1.5 max-h-60 list-none overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] p-1.5 shadow-[var(--shadow-overlay,0_20px_50px_rgba(0,0,0,.45))]"
        >
          {matches.length === 0 && <li className="px-2.5 py-2 text-sm text-muted-foreground" role="presentation">No state matches “{query}”.</li>}
          {matches.map(([code, name], index) => (
            <li
              key={code}
              id={`${listId}-${code}`}
              role="option"
              aria-selected={code === value}
              onMouseDown={(event) => { event.preventDefault(); pick(code); }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-foreground",
                index === active && "bg-[var(--primary-soft)]",
                code === value && "font-semibold text-[var(--accent-ink)]",
              )}
            >
              {name}<span className="text-xs text-muted-foreground">{code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
