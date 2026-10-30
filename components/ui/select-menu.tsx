"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * SelectMenu — the kit's searchable select (owner, 2026-10-29: the native dropdowns were "so plain",
 * and a long list needs a search at the top). One choice from a list, in a toolbar or a form:
 *
 *   trigger  a 36px control like the toolbar's search: an optional icon, the chosen option's name,
 *            a chevron. While it holds anything but its default it takes the brand tint, so a list
 *            that is filtered says so.
 *   panel    a search box at the top (typing filters at once), then the options in titled groups,
 *            each with an optional colour dot and count, and a tick on the chosen one. Arrow keys
 *            move, Enter picks, Escape closes; Radix handles focus and the click outside.
 *
 * Use it for a quick filter beside a search, or a select long enough to need searching. A filter
 * panel with several fields is still `FilterButton` + `FilterPanel` (UI-CONSISTENCY §6a).
 */
export type SelectMenuOption<K extends string> = {
  value: K;
  /** The name in the list. */
  label: string;
  /** Secondary context shown smaller and muted (for example, a state name beside its code). */
  description?: string;
  /** The name on the trigger when chosen, if it needs more words than the list ("With Aetna"). */
  triggerLabel?: string;
  /** Options with the same group sit under one heading, in the order given. */
  group?: string;
  count?: number;
  /** A colour class for a dot before the name (a carrier's colour, a status). */
  dot?: string;
  disabled?: boolean;
};

export function SelectMenu<K extends string>({
  label,
  value,
  defaultValue,
  options,
  onChange,
  disabled = false,
  id,
  ariaInvalid = false,
  icon,
  searchPlaceholder = "Search",
  className,
  panelClassName,
  panelAlign = "end",
}: {
  /** Accessible name of the control ("Show states"). */
  label: string;
  value: K;
  /** The unfiltered choice; any other value tints the trigger. */
  defaultValue?: K;
  options: ReadonlyArray<SelectMenuOption<K>>;
  onChange: (value: K) => void;
  disabled?: boolean;
  id?: string;
  ariaInvalid?: boolean;
  icon?: ReactNode;
  searchPlaceholder?: string;
  /** The trigger's width and layout (e.g. "w-52"). */
  className?: string;
  panelClassName?: string;
  /** The menu's anchor edge when its width differs from the trigger. */
  panelAlign?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const chosen = options.find((option) => option.value === value);
  const tinted = defaultValue !== undefined && value !== defaultValue;

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => options.filter((option) => !needle || option.label.toLowerCase().includes(needle) || option.description?.toLowerCase().includes(needle) || option.group?.toLowerCase().includes(needle) || option.triggerLabel?.toLowerCase().includes(needle)),
    [options, needle],
  );
  const pickable = shown.filter((option) => !option.disabled);

  const pick = (option: SelectMenuOption<K>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setActive(Math.max(0, options.filter((option) => !option.disabled).findIndex((option) => option.value === value)));
    }
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)), pickable.length - 1);
      setActive(next);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && pickable[active]) {
      event.preventDefault();
      pick(pickable[active]);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={ariaInvalid || undefined}
          aria-label={`${label}: ${chosen?.triggerLabel ?? chosen?.label ?? ""}${chosen?.description ? `, ${chosen.description}` : ""}`}
          className={cn(
            "inline-flex h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]",
            tinted
              ? "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[var(--primary-soft)] font-medium text-[var(--ink)]"
              : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]",
            disabled && "cursor-not-allowed opacity-45",
            className,
          )}
        >
          {icon && <span aria-hidden="true" className={cn("inline-flex shrink-0", tinted ? "text-[var(--accent-ink)]" : "text-[var(--muted)]")}>{icon}</span>}
          {chosen?.dot && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", chosen.dot)} />}
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
            <span className="shrink-0 truncate">{chosen?.triggerLabel ?? chosen?.label}</span>
            {chosen?.description && <>
              <span aria-hidden="true" className="shrink-0 text-xs font-normal text-[var(--muted)]">–</span>
              <span className="min-w-0 truncate text-xs font-normal text-[var(--muted)]">{chosen.description}</span>
            </>}
          </span>
          <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--muted)] transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      {/* Never taller than the room below the trigger, so the menu does not flip up over the form it
          belongs to (owner, 2026-10-29); the list inside shrinks to fit rather than fixing its height. */}
      <PopoverContent align={panelAlign} className={cn("flex w-72 max-h-[min(18rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden p-0", panelClassName)}>
        <label className="relative flex shrink-0 items-center border-b border-[var(--border)]">
          <span className="sr-only">{searchPlaceholder}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKey}
            placeholder={searchPlaceholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={pickable[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full bg-transparent pr-3 pl-9 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <div ref={listRef} id={listId} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {shown.length === 0 && <p className="m-0 px-3 py-6 text-center text-sm text-[var(--muted)]">Nothing matches “{query.trim()}”.</p>}
          {shown.map((option, at) => {
            // A heading where a group starts.
            const heading = option.group && option.group !== shown[at - 1]?.group ? option.group : null;
            const index = pickable.indexOf(option);
            const selected = option.value === value;
            return (
              <div key={option.value}>
                {heading && <p className="m-0 px-2.5 pt-2.5 pb-1 text-xs font-semibold text-[var(--muted)]">{heading}</p>}
                <div
                  id={index >= 0 ? `${listId}-${index}` : undefined}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  data-index={index}
                  onMouseEnter={() => index >= 0 && setActive(index)}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm",
                    index === active && "bg-[var(--surface-alt)]",
                    selected ? "font-medium text-[var(--ink)]" : "text-[var(--body)]",
                    option.disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  {option.dot !== undefined && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", option.dot)} />}
                  <span className={cn(option.description ? "w-8 shrink-0" : "min-w-0 flex-1 truncate")}>{option.label}</span>
                  {option.description && <>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-normal text-[var(--muted)]">
                      <span aria-hidden="true" className="shrink-0">–</span>
                      <span className="min-w-0 truncate">{option.description}</span>
                    </span>
                  </>}
                  {option.count !== undefined && <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{option.count}</span>}
                  <Check aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--accent-ink)]", !selected && "invisible")} />
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
