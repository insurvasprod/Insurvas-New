"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Unsaved changes stop a move away (foundation v3, 2026-10-27; first built for Settings › Calendar).
 *
 * While `dirty`: a reload or closed tab gets the browser's own prompt, and a click on any link or tab
 * outside `scope` is held while the person chooses Save changes, Discard changes or Stay. The held
 * click is replayed once they have chosen. Every form with a draft uses this, not window.confirm and
 * not a guard of its own.
 *
 *   const scope = useRef<HTMLDivElement>(null);
 *   <div ref={scope}>…the form…</div>
 *   <LeaveGuard dirty={dirty} scope={scope} onSave={save} onDiscard={discard} what="this calendar" />
 *
 * `onSave` resolves true when it saved; on false the person stays, with the save's own error shown.
 */
export function LeaveGuard({
  dirty,
  scope,
  onSave,
  onDiscard,
  what = "this page",
}: {
  dirty: boolean;
  /** Clicks inside it are the form's own and never held. */
  scope?: RefObject<HTMLElement | null>;
  onSave?: () => Promise<boolean> | boolean;
  onDiscard: () => void;
  /** Named in the question: "You changed {what} and have not saved it yet." */
  what?: string;
}) {
  const replaying = useRef(false);
  const [leaving, setLeaving] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const onClick = (event: MouseEvent) => {
      if (replaying.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = (event.target as Element | null)?.closest?.("a[href], [role='tab']");
      if (!(target instanceof HTMLElement) || scope?.current?.contains(target)) return;
      if (target.closest("[role='dialog']")) return;
      if (target instanceof HTMLAnchorElement && (target.target === "_blank" || target.hasAttribute("download") || target.getAttribute("href")?.startsWith("#"))) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(target);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, scope]);

  function leaveNow() {
    const target = leaving;
    setLeaving(null);
    if (!target) return;
    replaying.current = true;
    target.click();
    replaying.current = false;
  }

  return (
    <Dialog open={leaving !== null} onOpenChange={(open) => { if (!open && !saving) setLeaving(null); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription className="text-[var(--body)]">You changed {what} and have not saved it yet.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setLeaving(null)}>Stay</Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => { onDiscard(); leaveNow(); }}>Discard changes</Button>
          {onSave && (
            <Button
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void Promise.resolve(onSave()).then((ok) => {
                  setSaving(false);
                  if (ok) leaveNow();
                  else setLeaving(null);
                });
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
