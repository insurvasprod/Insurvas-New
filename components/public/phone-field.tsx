"use client";

import type { FocusEventHandler } from "react";

import { authControl } from "@/components/app/auth-card";
import { PhoneCountryPicker } from "@/components/public/phone-country-picker";
import { phoneCountry } from "@/lib/signup/phone";
import { cn } from "@/lib/utils";

/**
 * Country code and number on one row. Both boxes share the same height, radius and top edge,
 * so the "+1" never sits higher or lower than the number (manager review, 2026-10-29).
 */
export function PhoneField({ country, onCountryChange, number, onNumberChange, onBlur, invalid, describedBy, id }: {
  country: string;
  onCountryChange: (code: string) => void;
  number: string;
  onNumberChange: (value: string) => void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
}) {
  return (
    <div className="mt-1.5 flex items-stretch gap-2">
      <PhoneCountryPicker value={country} onChange={onCountryChange} className={cn(authControl, "mt-0 w-[120px] shrink-0")} />
      <input
        id={id}
        className={cn(authControl, "mt-0 min-w-0 flex-1")}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={24}
        required
        value={number}
        onChange={(event) => onNumberChange(event.target.value)}
        onBlur={onBlur}
        placeholder={phoneCountry(country)?.example}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}
