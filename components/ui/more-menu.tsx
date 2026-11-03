"use client";

import Link from "next/link";
import { ChevronDown, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * A header's "More" (owner 2026-11-02, the Book of business detail pages): a header shows at most two
 * buttons and the rest sit here. An item opens a page (`href`), downloads a file (an `/api/` address) or
 * runs `onSelect` (a confirm pop-up, a file picker). `row` draws the icon-only trigger a table row uses.
 */
export type MoreItem = { label: string; href?: string; onSelect?: () => void; disabled?: boolean };

/** Items may be written `cond && { … }`, so any falsy value (false, null, undefined, "", 0) is skipped. */
export function MoreMenu({ items, label = "More", row = false }: { items: Array<MoreItem | null | false | undefined | "" | 0>; label?: string; row?: boolean }) {
  const shown = items.filter((item): item is MoreItem => Boolean(item));
  if (!shown.length) return null;
  return (
    <DropdownMenu modal={false}>
      {row ? (
        <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={label}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger asChild><Button type="button" variant="outline">{label}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end">
        {shown.map((item) => item.href ? (
          <DropdownMenuItem key={item.label} asChild disabled={item.disabled}>
            {/* A file from an API route downloads; it is never a page to route or prefetch. */}
            {item.href.startsWith("/api/") ? <a href={item.href} download>{item.label}</a> : <Link href={item.href}>{item.label}</Link>}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={() => item.onSelect?.()}>{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
