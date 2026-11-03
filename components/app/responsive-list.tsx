"use client";

import { useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The Agent Floor and Callbacks on phones and tablets (2026-10-09 mobile).
 *
 * From lg (1024px) both pages draw their tables exactly as before. Below it the same rows — the
 * same row model, the same handlers — are drawn as a list of compact cards: the two or three facts
 * that matter, the primary action as a wide button, the rest behind a "More" menu. The tables'
 * columns cannot fit a phone, and beside the 264px rail a portrait tablet has 456–711px for the
 * list, which is a phone's width again.
 */

/** From lg: the desktop layout, tables and all. */
export const WIDE_QUERY = "(min-width: 1024px)";
/** From md: a tablet or wider (the sidebar rail is drawn from here). */
export const TABLET_QUERY = "(min-width: 768px)";

/**
 * True while `query` matches. The server, and the render that hydrates, assume `serverValue` (the
 * desktop by default); the browser's answer follows straight after. Both pages show their loading
 * skeleton on that first render, so no table flashes on a phone.
 */
export function useMediaQuery(query: string, serverValue = true) {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

/** One thing a row lets you do: a link or a button. The table draws every one; a card puts one up front. */
export type RowAction = {
  key: string;
  label: ReactNode;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** The filled button; on a card, the one drawn up front. */
  primary?: boolean;
  title?: string;
  /** aria-pressed, for a button that shows the row is the one open in the panel. */
  pressed?: boolean;
  icon?: ReactNode;
  /** It opens a DetailPanel: the menu must not pull focus back to itself as it closes. */
  opensPanel?: boolean;
};

/** A row action as a button, exactly as the tables drew it by hand before. */
export function ActionButton({ action, size, className }: { action: RowAction; size: "sm" | "default"; className?: string }) {
  const variant = action.primary ? "default" : "outline";
  if (action.href) {
    return (
      <Button asChild size={size} variant={variant} title={action.title} className={className}>
        <Link href={action.href}>{action.icon}{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" size={size} variant={variant} title={action.title} disabled={action.disabled} aria-pressed={action.pressed} onClick={action.onSelect} className={className}>
      {action.icon}{action.label}
    </Button>
  );
}

/**
 * A card's actions: the primary one as a wide button (the row's `primary`, else its first link,
 * else its first action) and the rest in a "More" menu. 36px throughout, for a thumb.
 */
export function CardActions({ actions, label }: { actions: RowAction[]; label: string }) {
  const skipFocusReturn = useRef(false);
  if (!actions.length) return null;
  const lead = actions.find((action) => action.primary) ?? actions.find((action) => action.href) ?? actions[0];
  const rest = actions.filter((action) => action !== lead);
  return (
    <div className="flex items-center gap-2">
      <ActionButton action={lead} size="default" className="min-w-0 flex-1" />
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={`More actions for ${label}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-48"
            onCloseAutoFocus={(event) => { if (skipFocusReturn.current) { event.preventDefault(); skipFocusReturn.current = false; } }}
          >
            {rest.map((action) => action.href ? (
              <DropdownMenuItem key={action.key} asChild disabled={action.disabled} className="min-h-9">
                <Link href={action.href} title={action.title}>{action.icon}{action.label}</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key={action.key}
                disabled={action.disabled}
                title={action.title}
                className="min-h-9"
                onSelect={() => { skipFocusReturn.current = Boolean(action.opensPanel); action.onSelect?.(); }}
              >
                {action.icon}{action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * The cards' list, inside the TableCard where the table was. One column; two once the list itself
 * is 576px wide (a tablet in landscape, or portrait with the rail collapsed). Rules between cards,
 * not a card per row, so it is not a card inside a card (UI-CONSISTENCY §8).
 */
export function CardList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="@container">
      <ul aria-label={label} className={cn("m-0 grid list-none grid-cols-1 p-0 @xl:grid-cols-2", className)}>{children}</ul>
    </div>
  );
}

/**
 * A DataToolbar below lg: the search takes the whole first row; the actions row under it starts at
 * the left (Filters, saved views); Clear and Refresh sit in an `ml-auto` group at its right, and keep
 * to the right when a narrow phone wraps them onto a line of their own.
 */
export const COMPACT_TOOLBAR = "[&>div:first-child]:basis-full [&>div:last-child]:ml-0 [&>div:last-child]:w-full";

/** One card in a CardList. */
export const cardItem = "m-row flex min-w-0 flex-col gap-2 border-t border-[var(--border)] px-4 py-3 first:border-t-0 @xl:odd:border-r @xl:[&:nth-child(2)]:border-t-0";
