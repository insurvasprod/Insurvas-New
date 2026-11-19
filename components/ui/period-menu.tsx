"use client";

import Link from "next/link";
import { CalendarDays, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The page's period as a filter button on the title line's right (owner 2026-11-18: "Today · 7 days · 30 days"
 * is not a sub-page; it is a filter at the top right). A calendar, the chosen period's name and a chevron; the
 * menu lists every period with a tick on the chosen one. Each option is a link, so the period stays in the
 * address (a reload or a shared link lands on the same view) and the page's server read is unchanged.
 *
 * Use it in PageHeader `actions` (it counts toward the header's two buttons), never as `tabs`.
 */
export type PeriodOption = { key: string; label: string; href: string };

export function PeriodMenu({ value, options, label = "Period", className }: {
  value: string;
  options: ReadonlyArray<PeriodOption>;
  /** Accessible name: "Period", "Range". */
  label?: string;
  className?: string;
}) {
  const current = options.find((option) => option.key === value) ?? options[0];
  if (!current) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" aria-label={`${label}: ${current.label}`} className={cn("gap-2", className)}>
          <CalendarDays aria-hidden="true" />
          {current.label}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {options.map((option) => {
          const on = option.key === current.key;
          return (
            <DropdownMenuItem key={option.key} asChild>
              <Link href={option.href} scroll={false} aria-current={on ? "true" : undefined} className="flex items-center justify-between gap-3">
                <span>{option.label}</span>
                <Check aria-hidden="true" className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
