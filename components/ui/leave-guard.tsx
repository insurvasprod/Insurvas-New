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
  mode = "confirm",
  onPause,
  what = "this page",
}: {
  dirty: boolean;
  /** Clicks inside it are the form's own and never held. */
  scope?: RefObject<HTMLElement | null>;
  onSave?: () => Promise<boolean> | boolean;
  onDiscard: () => void;
  /** Autosaved forms ask for pause context on in-app navigation; browser close stays best-effort. */
  mode?: "confirm" | "autosaved-draft";
  onPause?: (reason: string, notes: string) => Promise<boolean> | boolean;
  /** Named in the question: "You changed {what} and have not saved it yet." */
  what?: string;
}) {
  const replaying = useRef(false);
  const [leaving, setLeaving] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const onClick = (event: MouseEvent) => {
      if (replaying.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // [data-navigates]: a button that changes what the page shows, like the Settings menu's items.
      const target = (event.target as Element | null)?.closest?.("a[href], [role='tab'], [data-navigates]");
      if (!(target instanceof HTMLElement) || scope?.current?.contains(target)) return;
      if (target.closest("[role='dialog']")) return;
      if (target instanceof HTMLAnchorElement && (target.target === "_blank" || target.hasAttribute("download") || target.getAttribute("href")?.startsWith("#"))) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(target);
    };
    if (mode !== "autosaved-draft") window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, scope, mode]);

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
        <DialogTitle>{mode === "autosaved-draft" ? "Save this draft and leave?" : "Save your changes?"}</DialogTitle>
        <DialogDescription className="text-[var(--body)]">{mode === "autosaved-draft" ? `Your answers are saved automatically. Add a reason and notes so you can pick up ${what} later.` : `You changed ${what} and have not saved it yet.`}</DialogDescription>
        </DialogHeader>
      {mode === "autosaved-draft" && (
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="autosaved-draft-reason">Reason for pausing
            <input id="autosaved-draft-reason" required maxLength={120} value={reason} onChange={(event) => setReason(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 font-normal" placeholder="For example, waiting for customer details" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="autosaved-draft-notes">Notes
            <textarea id="autosaved-draft-notes" required maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24 rounded-md border border-input bg-background px-3 py-2 font-normal" placeholder="Add anything you’ll want to remember when you resume" />
          </label>
          {saveError && <p role="alert" className="text-sm text-[var(--color-danger)]">{saveError}</p>}
        </div>
      )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setLeaving(null)}>Stay</Button>
        {mode !== "autosaved-draft" && <Button type="button" variant="outline" disabled={saving} onClick={() => { onDiscard(); leaveNow(); }}>Discard changes</Button>}
        {mode === "autosaved-draft" && onPause && (
          <Button type="button" disabled={saving || !reason.trim() || !notes.trim()} onClick={() => {
            setSaving(true);
            setSaveError(null);
            void Promise.resolve(onPause(reason.trim(), notes.trim())).then((ok) => {
              setSaving(false);
              if (ok) { setReason(""); setNotes(""); leaveNow(); }
              else setSaveError("The draft could not be saved. Check your connection and try again.");
            }).catch(() => {
              setSaving(false);
              setSaveError("The draft could not be saved. Check your connection and try again.");
            });
          }}>{saving ? "Saving draft…" : "Save draft and leave"}</Button>
        )}
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
