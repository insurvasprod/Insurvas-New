"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

import { authControl } from "@/components/app/auth-card";
import { cn } from "@/lib/utils";

/**
 * The open list under an auth picker: one surface for StatePicker and MultiPicker. A hairline edge
 * and one soft shadow (owner, 2026-10-27: the earlier shadow was heavy on the light canvas).
 */
export const pickerPanel =
  "z-50 flex flex-col overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] shadow-[0_10px_28px_-10px_rgba(0,0,0,.22),0_1px_2px_rgba(0,0,0,.06)]";

/** The scrolling list inside the panel. */
export const pickerList = "m-0 min-h-0 flex-1 list-none overflow-y-auto p-1 outline-none";

/** One row: 36px, a grey hover, the chosen row lightly filled and marked by a check rather than colour alone. */
export const pickerOption = (active: boolean, chosen: boolean) =>
  cn(
    "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm tracking-[-0.01em] text-foreground transition-colors duration-100",
    chosen && "bg-[color-mix(in_srgb,var(--primary-soft)_55%,transparent)] font-semibold",
    active && "bg-[var(--surface-alt)]",
  );

/**
 * Where an open list is drawn: the auth shell, outside the form column. Each line of that column
 * is its own layer while the entrance animation holds (`.m-stagger > *`), so a list drawn inside it
 * went under every later line — the signed-in line, the legal links (owner, 2026-10-27). The shell
 * keeps the theme's variables; the body is the fallback outside it.
 */
function portalTarget(anchor: HTMLElement | null) {
  return anchor?.closest<HTMLElement>(".portal-auth-split-shell") ?? document.body;
}

/**
 * Fixed position under (or over) the anchor, as tall as the content up to `wanted`, and never taller
 * than the room left in the window, so opening a list never makes the page scroll. Follows scroll
 * and resize while open.
 */
export function useAnchoredPanel(anchor: RefObject<HTMLElement | null>, open: boolean, wanted: number) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const gap = 6;
      const margin = 12;
      const below = window.innerHeight - box.bottom - gap - margin;
      const above = box.top - gap - margin;
      const up = below < wanted && above > below;
      const room = up ? above : below;
      setStyle({
        position: "fixed",
        left: box.left,
        width: box.width,
        maxHeight: Math.max(144, Math.min(wanted, room)),
        ...(up ? { bottom: window.innerHeight - box.top + gap } : { top: box.bottom + gap }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, open, wanted]);

  return open ? style : null;
}

/** Draws children at the auth shell, outside the column's layers (see portalTarget). */
export function PickerPortal({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
  return createPortal(children, portalTarget(anchor.current));
}

/** The box in front of a multi-select row: empty, or filled with a check. */
function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-100",
        on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)] bg-card",
      )}
    >
      {on && <Check className="size-3 stroke-[3]" />}
    </span>
  );
}

const ROW = 36;
const FOOTER = 41;

/**
 * Several answers from a short fixed list, in one 44px field (owner, 2026-10-27: "What you sell" and
 * "Where your leads come from" as dropdowns, not rows of chips).
 *
 * The field shows each pick as a tag you can remove without opening the list, then "+N" for those
 * that do not fit. The list stays open while you tick, ends with "N selected · Clear", and closes on
 * Escape, Enter on the field, or a click outside.
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
  const fieldRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const tagsRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [fits, setFits] = useState(Number.POSITIVE_INFINITY);
  const panelStyle = useAnchoredPanel(fieldRef, open, options.length * ROW + 8 + FOOTER + 2);

  const picked = options.filter((option) => value.includes(option.value));
  const hidden = Math.max(0, picked.length - fits);

  // How many tags fit on the one line, leaving room for "+N" when some do not.
  useLayoutEffect(() => {
    const row = tagsRef.current;
    if (!row) return;
    const measure = () => {
      const tags = [...row.querySelectorAll<HTMLElement>("[data-tag]")];
      const limit = row.clientWidth;
      let count = 0;
      for (const [index, tag] of tags.entries()) {
        const room = index === tags.length - 1 ? limit : limit - 44;
        if (tag.offsetLeft + tag.offsetWidth > room) break;
        count += 1;
      }
      setFits(count);
    };
    setFits(Number.POSITIVE_INFINITY);
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!fieldRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function show() {
    setActive(0);
    setOpen(true);
    window.requestAnimationFrame(() => listRef.current?.focus());
  }

  function hide(refocus = true) {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
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
    else if (event.key === "Escape") { event.preventDefault(); hide(); }
    else if (event.key === "Tab") hide();
  }

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return (
    <div
      ref={fieldRef}
      className={cn(authControl, "relative flex cursor-pointer items-center gap-1.5 px-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring-color)]", open && "border-[var(--accent-ink)]")}
      onClick={(event) => { if (event.target === event.currentTarget) { if (open) hide(); else show(); } }}
    >
      <span ref={tagsRef} className={cn("flex min-w-0 items-center gap-1 overflow-hidden", picked.length ? "flex-1" : "hidden")}>
        {picked.map((option, index) => (
          <span
            key={option.value}
            data-tag=""
            className={cn(
              "inline-flex h-7 max-w-[11rem] shrink-0 items-center gap-1 rounded-md bg-[var(--surface-alt)] pl-2 pr-1 text-sm font-medium text-foreground",
              index >= fits && "invisible absolute",
            )}
          >
            <span className="truncate">{option.label}</span>
            <button
              type="button"
              onClick={() => toggle(option.value)}
              aria-label={`Remove ${option.label}`}
              tabIndex={index >= fits ? -1 : 0}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-[var(--border)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {hidden > 0 && <span className="shrink-0 px-1 text-sm font-semibold tabular-nums text-muted-foreground">+{hidden}</span>}
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? hide() : show())}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); show(); } }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={picked.length ? `${label}: ${picked.map((option) => option.label).join(", ")}` : label}
        aria-describedby={describedBy}
        className={cn("flex h-full items-center gap-2 rounded-sm pr-1.5 text-left outline-none", picked.length ? "shrink-0" : "min-w-0 flex-1 pl-1.5")}
      >
        {picked.length === 0 && <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>}
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && panelStyle && (
        <PickerPortal anchor={fieldRef}>
          <div ref={panelRef} style={panelStyle} className={pickerPanel}>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-multiselectable="true"
              aria-label={label}
              tabIndex={-1}
              aria-activedescendant={`${listId}-${options[active]?.value}`}
              onKeyDown={onListKey}
              className={pickerList}
            >
              {options.map((option, index) => {
                const on = value.includes(option.value);
                return (
                  <li
                    key={option.value}
                    id={`${listId}-${option.value}`}
                    data-index={index}
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
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 text-xs">
              <span className="tabular-nums text-muted-foreground" aria-live="polite">{picked.length} selected</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange([])}
                disabled={picked.length === 0}
                className="rounded-sm font-semibold text-[var(--accent-ink)] hover:underline disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-60"
              >
                Clear
              </button>
            </div>
          </div>
        </PickerPortal>
      )}
    </div>
  );
}
