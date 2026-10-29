"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The one place an explanation goes (2026-10-09). A screen states what it is in a few words; the
 * why and the how live behind a small (i) beside the term.
 *
 * It opens when the mouse rests on it (owner, 2026-10-29: "people can hover over it"), and on click,
 * tap and Enter/Space, so it works on a phone and from the keyboard. Moving onto the tip keeps it
 * open, and Escape or a click outside closes it (WCAG 1.4.13). A click pins a hover-opened tip.
 *
 * Never for compliance or legal wording, for what a field needs while it is typed in, or for what an
 * action will do: those stay on the screen.
 */
export function InfoTip({ label, children, className, side = "top" }: {
  /** What the tip explains, for the button's accessible name: "About True CPA". */
  label: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Mouse only: a touch or pen tap goes through the click below.
  function hover(event: PointerEvent, next: boolean, delay: number) {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(timer.current);
    if (!next && pinned.current) return;
    timer.current = window.setTimeout(() => setOpen(next), delay);
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) pinned.current = false;
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger
        type="button"
        aria-label={label}
        onPointerEnter={(event) => hover(event, true, 120)}
        onPointerLeave={(event) => hover(event, false, 160)}
        onClick={(event) => {
          // Radix would toggle; a click on a tip the mouse already opened pins it instead.
          event.preventDefault();
          window.clearTimeout(timer.current);
          if (open && !pinned.current) {
            pinned.current = true;
            return;
          }
          pinned.current = !open;
          setOpen(!open);
        }}
        className={cn(
          "relative inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-[var(--muted)] outline-none transition-colors duration-150 before:absolute before:-inset-1.5 before:content-[''] hover:text-[var(--accent-ink)] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-[var(--accent-ink)]",
          className,
        )}
      >
        <Info className="size-4" aria-hidden="true" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={(event) => hover(event, true, 0)}
          onPointerLeave={(event) => hover(event, false, 160)}
          className="z-50 max-w-[300px] rounded-md border border-border bg-popover px-3 py-2 text-xs leading-normal font-normal tracking-normal normal-case text-[var(--body)] shadow-[0_8px_24px_rgba(16,20,26,.14)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {children}
          <PopoverPrimitive.Arrow className="fill-[var(--color-card-bg)]" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
