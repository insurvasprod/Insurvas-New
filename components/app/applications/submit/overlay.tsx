"use client";

/**
 * The overlay frame the LA-3 boards draw (l3-ov-capture, l3-ov-counteroffer, l3-ov-spouse): a white
 * card with a header row (title, one line under it, anything else, then Close), a padded body, and a
 * footer strip on the page grey with a one-line note on the left and the actions on the right,
 * primary last. Built on the shared Dialog, so focus, Escape and the backdrop behave as everywhere.
 */

import type { ClipboardEvent, FormEvent, ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function Overlay({ open, onOpenChange, width = 760, title, subtitle, headerExtra, children, footerNote, actions, onSubmit, onPaste }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: 720 | 760 | 840;
  title: ReactNode;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  footerNote?: ReactNode;
  actions?: ReactNode;
  /** When given, the whole card is a form and a `type="submit"` action submits it. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onPaste?: (event: ClipboardEvent) => void;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px]">
        <div className="min-w-0">
          <DialogTitle className="text-lg font-semibold text-[var(--ink)]">{title}</DialogTitle>
          {subtitle ? <DialogDescription className="mt-1 text-sm text-[var(--muted)]">{subtitle}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-3.5">
          {headerExtra}
          <DialogClose asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Close"><X aria-hidden="true" /></Button>
          </DialogClose>
        </div>
      </div>
      <div className="flex max-h-[min(70vh,720px)] flex-col gap-[18px] overflow-y-auto p-[22px]">{children}</div>
      {(footerNote || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5">
          <span className="min-w-0 flex-1 text-xs text-[var(--muted)]">{footerNote}</span>
          {actions && <span className="flex flex-wrap items-center gap-2.5">{actions}</span>}
        </div>
      )}
    </>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onPaste={onPaste}
        className={cn(
          "gap-0 overflow-hidden rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] p-0",
          width === 720 ? "sm:max-w-[720px]" : width === 840 ? "sm:max-w-[840px]" : "sm:max-w-[760px]",
        )}
      >
        {onSubmit ? <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col">{inner}</form> : inner}
      </DialogContent>
    </Dialog>
  );
}
