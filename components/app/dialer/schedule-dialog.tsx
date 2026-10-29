"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * One pop-up for both ways the Dialer schedules time with the customer (owner 2026-10-27): the
 * Callback scheduled outcome and Book appointment. Same shell, same calendar (CallbackPicker) inside;
 * only the title, the line under it, the fields and the submit label differ, and each flow keeps its
 * own rules and server checks.
 */
export function ScheduleDialog({ open, onOpenChange, title, description, submitLabel, busyLabel, busy, submitDisabled, submitTitle, onSubmit, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  submitDisabled: boolean;
  submitTitle?: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id="schedule-form" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!submitDisabled && !busy) onSubmit(); }}>
          {children}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" form="schedule-form" disabled={submitDisabled || busy} title={submitTitle}>{busy ? busyLabel : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
