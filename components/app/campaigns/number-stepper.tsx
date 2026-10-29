"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { inputControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A whole number with − and + either side (mixing weight, return window days). The text stays
 * editable; the buttons step from whatever it holds, clamped to `min`..`max`. `after` is drawn
 * beside it: a unit, or the share it buys.
 */
export function NumberStepper({ id, value, onChange, min, max, label, after, disabled = false }: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  /** What the number is, for the − and + buttons' names. */
  label: string;
  after?: ReactNode;
  disabled?: boolean;
}) {
  const number = Number(value);
  const known = value.trim() !== "" && Number.isInteger(number);
  const step = (by: number) => onChange(String(Math.min(max, Math.max(min, (known ? number : min) + by))));
  return <div className="mt-1.5 flex items-center gap-2">
    <Button type="button" variant="outline" size="icon" aria-label={`Less ${label}`} disabled={disabled || (known && number <= min)} onClick={() => step(-1)}><Minus aria-hidden="true" /></Button>
    <input id={id} className={cn(inputControl, "w-16 text-center tabular-nums")} inputMode="numeric" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))} />
    <Button type="button" variant="outline" size="icon" aria-label={`More ${label}`} disabled={disabled || (known && number >= max)} onClick={() => step(1)}><Plus aria-hidden="true" /></Button>
    {after && <span className="min-w-0 text-sm text-[var(--body)]">{after}</span>}
  </div>;
}
