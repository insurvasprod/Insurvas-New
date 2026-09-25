"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The overlay frame the p-ov-* boards share, for the dialer's two overlays (the number check and
 * the call-outcome wizard). Radix Dialog underneath — focus trap, Escape, focus back to the
 * trigger, role=dialog with aria-labelledby/-describedby — composed here rather than through
 * components/ui/dialog.tsx, whose content is centred with a translate that the `m-swap` entry
 * animation (a transform) would fight. The content sits inside the overlay, which is the flex
 * container that top-aligns it, exactly as the board's backdrop does.
 */

const WIDTH = { 760: "max-w-[760px]", 880: "max-w-[880px]" } as const;
// Top padding and max height per board: 96/136 for the number check, 76/116 for the outcome wizard.
const TOP = { 96: "sm:pt-[96px]", 76: "sm:pt-[76px]" } as const;
const MAX_H = { 96: "sm:max-h-[calc(100dvh-136px)]", 76: "sm:max-h-[calc(100dvh-116px)]" } as const;

export function OverlayFrame({
  open,
  onOpenChange,
  width,
  top,
  title,
  description,
  counter,
  children,
  footerNote,
  footerActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: keyof typeof WIDTH;
  top: keyof typeof TOP;
  title: ReactNode;
  description: ReactNode;
  counter?: ReactNode;
  children: ReactNode;
  footerNote?: ReactNode;
  footerActions?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-[rgba(10,12,16,0.55)] px-4 pt-4", TOP[top])}>
          <DialogPrimitive.Content
            className={cn(
              "m-swap flex max-h-[calc(100dvh-32px)] w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_24px_64px_rgba(0,0,0,0.28)] outline-none",
              WIDTH[width],
              MAX_H[top],
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px]">
              <div className="min-w-0">
                <DialogPrimitive.Title className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-[5px] mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{description}</DialogPrimitive.Description>
              </div>
              <div className="flex shrink-0 items-center gap-3.5">
                {counter && <span className="text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] whitespace-nowrap text-[var(--accent-ink)]">{counter}</span>}
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="inline-flex size-[30px] cursor-pointer items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--muted)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </DialogPrimitive.Close>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">{children}</div>
            {(footerNote || footerActions) && (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5">
                <span className="max-w-[380px] text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{footerNote}</span>
                {footerActions && <span className="flex flex-wrap items-center gap-2.5">{footerActions}</span>}
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
