"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { CountryFlag } from "@/components/public/country-flag";
import { PHONE_COUNTRIES, phoneCountry } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

/**
 * The phone number's country (2026-10-26): every country, in the app's own dark list with a flag,
 * the name and the calling code, and a search box on top (by name, two-letter code or "+383").
 * Arrow keys move, Enter picks, Escape closes.
 */
export function PhoneCountryPicker({ value, onChange, className }: { value: string; onChange: (code: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = phoneCountry(value);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\+/, "");
    if (!needle) return PHONE_COUNTRIES;
    return PHONE_COUNTRIES.filter((country) => country.name.toLowerCase().includes(needle) || country.code.toLowerCase() === needle || country.dial.startsWith(needle));
  }, [query]);

  function choose(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function move(next: number) {
    const index = Math.max(0, Math.min(shown.length - 1, next));
    setActive(index);
    listRef.current?.querySelectorAll("[role=option]")[index]?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); move(active + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(active - 1); }
    else if (event.key === "Enter") { event.preventDefault(); const pick = shown[active]; if (pick) choose(pick.code); }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { setQuery(""); setActive(Math.max(0, PHONE_COUNTRIES.findIndex((country) => country.code === value))); } }}>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={`Country code: ${current?.name ?? "choose"}`}
        className={cn("flex items-center gap-2 rounded-md border border-[var(--border-strong)] bg-card px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <CountryFlag code={value} />
        <span className="tabular-nums">+{current?.dial}</span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
          className="z-50 w-[300px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--color-card)] text-foreground shadow-[var(--shadow-overlay)]"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search country or code"
              aria-label="Search country or code"
              aria-controls="phone-country-list"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul ref={listRef} id="phone-country-list" role="listbox" aria-label="Country code" className="m-0 max-h-[280px] list-none overflow-y-auto p-1">
            {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">No country matches “{query}”.</li>}
            {shown.map((country, index) => {
              const selected = country.code === value;
              return (
                <li
                  key={country.code}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(country.code)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm", index === active ? "bg-[var(--surface-alt)]" : "")}
                >
                  <CountryFlag code={country.code} />
                  <span className="min-w-0 flex-1 truncate">{country.name}</span>
                  <span className="tabular-nums text-muted-foreground">+{country.dial}</span>
                  <Check className={cn("size-4 text-[var(--accent-ink)]", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                </li>
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
