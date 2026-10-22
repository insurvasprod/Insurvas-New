"use client";

import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The one place an explanation goes (2026-10-09). A screen states what it is in a few words; the
 * why and the how live behind a small "?" beside the term. It opens on click, tap and Enter/Space —
 * not hover only — so it works on a phone and from the keyboard, and Escape or a click outside
 * closes it.
 *
 * Never for compliance or legal wording: that stays on the screen, in full.
 */
export function InfoTip({ label, children, className, side = "top" }: {
  /** What the tip explains, for the button's accessible name: "About True CPA". */
  label: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={label}
        className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[300px] rounded-md border border-border bg-popover px-3 py-2 text-xs leading-normal font-normal text-[var(--body)] shadow-[0_8px_24px_rgba(16,20,26,.14)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-[var(--color-card-bg)]" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
