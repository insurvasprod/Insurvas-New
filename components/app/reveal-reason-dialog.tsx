"use client";

/**
 * Asks why before an SSN or a bank / card number is revealed (audit 2026-10-16). The server refuses
 * a reveal without a reason (lib/applications/revealReason.ts) and keeps it on the access record.
 *
 *   const { ask, dialog } = useRevealReason();
 *   const reason = await ask("SSN");   // null when cancelled
 *   ...render {dialog} once in the component.
 *
 * The last reason given on this screen is offered again, so reading several numbers back on one
 * call is one click each, but it is never sent without the person confirming it.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { REVEAL_REASON_MAX, REVEAL_REASON_MIN } from "@/lib/applications/revealReason";

export function useRevealReason(): { ask: (label: string) => Promise<string | null>; dialog: ReactNode } {
  const [label, setLabel] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const last = useRef("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    if (value) last.current = value;
    resolver.current?.(value);
    resolver.current = null;
    setLabel(null);
  }, []);

  const ask = useCallback((fieldLabel: string) => {
    resolver.current?.(null);
    setReason(last.current);
    setLabel(fieldLabel);
    return new Promise<string | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const trimmed = reason.trim();
  const ok = trimmed.length >= REVEAL_REASON_MIN && trimmed.length <= REVEAL_REASON_MAX;

  const dialog = (
    <Dialog open={label !== null} onOpenChange={(open) => { if (!open) settle(null); }}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); if (ok) settle(trimmed); }}>
          <DialogHeader>
            <DialogTitle>Reveal {label ?? "value"}</DialogTitle>
            <DialogDescription>Recorded with your name in the access log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-3">
            <Label htmlFor="reveal-reason">Reason</Label>
            <textarea
              id="reveal-reason"
              rows={2}
              autoFocus
              maxLength={REVEAL_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (ok) settle(trimmed); } }}
              placeholder="e.g. Reading it back to the customer to confirm"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => settle(null)}>Cancel</Button>
            <Button type="submit" disabled={!ok}>Reveal</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}
