"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

import { authControl } from "@/components/app/auth-card";
import { cn } from "@/lib/utils";

/** The open list under an auth picker: one surface for StatePicker and MultiPicker. */
export const pickerPanel =
  "absolute inset-x-0 z-30 m-0 list-none overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,.28),0_2px_8px_rgba(0,0,0,.08)]";

/** One row of that list: 40px, a quiet hover, the chosen row marked by a check rather than colour alone. */
export const pickerOption = (active: boolean, chosen: boolean) =>
  cn(
    "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm tracking-[-0.01em] text-foreground transition-colors duration-100",
    active && "bg-[var(--surface-alt)]",
    chosen && "font-semibold",
  );

/** The box in front of a multi-select row: empty, or filled with a check. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-100",
        on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] bg-card",
      )}
    >
      {on && <Check className="size-3 stroke-[3]" />}
    </span>
  );
}

/**
 * Several answers from a short fixed list, in one 44px field (owner, 2026-10-27: "What you sell" and
 * "Where your leads come from" as dropdowns, not rows of chips). The field names what is picked; the
 * list stays open while you tick, and opens upward when there is no room below, so it never makes
 * the page scroll.
 */
export function MultiPicker({ options, value, onChange, placeholder, label, describedBy }: {
  options: readonly { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  /** The field's name, for the button and the list. */
  label: string;
  describedBy?: string;
}) {
  const listId = `${useId()}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);

  const picked = options.filter((option) => value.includes(option.value));
  const summary = picked.length === 0 ? "" : picked.length <= 2 ? picked.map((option) => option.label).join(", ") : `${picked[0].label}, ${picked[1].label} +${picked.length - 2}`;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function show() {
    const box = buttonRef.current?.getBoundingClientRect();
    // About 40px a row plus the padding; open upward only when that does not fit below but does above.
    const needed = Math.min(options.length * 40 + 12, 300);
    if (box) setUp(window.innerHeight - box.bottom < needed + 8 && box.top > needed + 8);
    setActive(0);
    setOpen(true);
    window.requestAnimationFrame(() => listRef.current?.focus());
  }

  function toggle(next: string) {
    onChange(value.includes(next) ? value.filter((item) => item !== next) : [...value, next]);
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (options[active]) toggle(options[active].value); }
    else if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); show(); } }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={picked.length ? `${label}: ${picked.map((option) => option.label).join(", ")}` : label}
        aria-describedby={describedBy}
        className={cn(authControl, "flex items-center gap-2 pr-3 text-left", open && "border-[var(--accent-ink)]")}
      >
        <span className={cn("min-w-0 flex-1 truncate", !summary && "text-muted-foreground")}>{summary || placeholder}</span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${listId}-${options[active]?.value}`}
          onKeyDown={onListKey}
          className={cn(pickerPanel, "max-h-[300px] outline-none", up ? "bottom-full mb-1.5" : "top-full mt-1.5")}
        >
          {options.map((option, index) => {
            const on = value.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${listId}-${option.value}`}
                role="option"
                aria-selected={on}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setActive(index); toggle(option.value); }}
                onMouseEnter={() => setActive(index)}
                className={pickerOption(index === active, on)}
              >
                <Tick on={on} />
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
