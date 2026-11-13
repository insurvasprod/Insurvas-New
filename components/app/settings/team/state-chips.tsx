"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { US_STATES } from "@/lib/appointments/constants";
import { dayMonthYear } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

const NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
export const stateName = (code: string) => NAMES.get(code) ?? code;

const CHIP = "inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--color-card)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Licensed in (board screen 2): one chip a state, with how many of the agency's carriers are appointed
 * there ("licence only" when none is). A chip opens its licence end date and Remove; "+ Add a state" picks one.
 */
export function StateChips({ states, expiries, carriersIn, onChange, disabled }: {
  states: string[];
  expiries: Record<string, string | null>;
  /** How many of the agency's carriers are appointed in a state; absent while the carriers are read. */
  carriersIn?: (code: string) => number;
  onChange: (states: string[], expiries: Record<string, string | null>) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const sorted = [...states].sort();
  const needle = query.trim().toLowerCase();
  const addable = US_STATES.filter(([code, name]) => !states.includes(code) && (!needle || code.toLowerCase() === needle || name.toLowerCase().includes(needle)));
  const ends = sorted.filter((code) => expiries[code]).map((code) => `${code} ${dayMonthYear(`${expiries[code]}T12:00:00Z`, "UTC")}`);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {sorted.map((code) => {
          const count = carriersIn?.(code);
          return (
            <Popover key={code}>
              <PopoverTrigger asChild>
                <button type="button" className={CHIP} disabled={disabled} aria-label={`${stateName(code)}: licence end date or remove`}>
                  {code}
                  {count !== undefined && <span className="font-normal text-[var(--muted)]">{count ? `${count} ${count === 1 ? "carrier" : "carriers"}` : "licence only"}</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--ink)]">
                    {stateName(code)} licence valid through
                    <input
                      type="date"
                      className="h-9 rounded-[8px] border border-[var(--border-strong)] bg-[var(--color-card)] px-3 text-sm font-normal text-[var(--body)]"
                      value={expiries[code] ?? ""}
                      onChange={(event) => onChange(states, { ...expiries, [code]: event.target.value || null })}
                    />
                    <span className="font-normal text-[var(--muted)]">Optional. After this date they get no leads in {stateName(code)}.</span>
                  </label>
                  <Button type="button" variant="outline" size="sm" className="self-start text-[var(--error-ink)]" onClick={() => { const next = { ...expiries }; delete next[code]; onChange(states.filter((item) => item !== code), next); }}>
                    Remove {code}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
        <Popover open={adding} onOpenChange={(open) => { setAdding(open); if (!open) setQuery(""); }}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(CHIP, "border-dashed text-[var(--accent-ink)]")} disabled={disabled}>
              <Plus aria-hidden="true" className="size-3.5" />Add a state
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="flex flex-col gap-2">
              <ToolbarSearch value={query} onChange={setQuery} placeholder="Find a state" />
              <ul className="m-0 max-h-60 list-none overflow-y-auto p-0">
                {addable.map(([code, name]) => (
                  <li key={code}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm text-[var(--body)] hover:bg-[var(--surface-alt)]"
                      onClick={() => { onChange([...states, code], expiries); setQuery(""); }}
                    >
                      <span className="w-7 font-mono text-xs text-[var(--muted)]">{code}</span>{name}
                    </button>
                  </li>
                ))}
                {addable.length === 0 && <li className="px-2 py-1.5 text-sm text-[var(--muted)]">No state matches</li>}
              </ul>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {ends.length > 0 && <span className="text-xs text-[var(--muted)]">Licence ends: {ends.join(" · ")}</span>}
    </div>
  );
}
