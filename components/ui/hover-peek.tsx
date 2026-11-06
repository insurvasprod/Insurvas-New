"use client";

import type { ReactNode } from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * A read-only peek at a row (owner 2026-11-06, Retention round 3): resting on, or focusing, a row's name
 * shows a small card over the table with the few facts that decide what to do. Nothing in it is editable;
 * the name itself is the link to the record's page, so the table never opens up or changes shape.
 * Radix handles the delay, focus and the pointer leaving; it portals, so a scrolling table never clips it.
 */
export function HoverPeek({ trigger, children, className }: { trigger: ReactNode; children: ReactNode; className?: string }) {
  return (
    <HoverCardPrimitive.Root openDelay={350} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>{trigger}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="right"
          align="start"
          sideOffset={10}
          className={cn(
            "z-50 grid w-[320px] gap-1.5 rounded-menu border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--body)] shadow-[var(--shadow-overlay)] outline-none",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            className,
          )}
        >
          {children}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
