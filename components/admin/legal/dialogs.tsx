"use client";

import { useEffect, useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout, control, Field, KeyValues } from "@/components/app/settings/primitives";
import { LEGAL_DOC_LABELS, type LegalDocType } from "@/lib/legal/constants";
import { legalDay, type AdminLegalVersion } from "@/lib/legal/adminTypes";
import { type EditorState, plural, post } from "./model";

export function PublishDialog({
  open,
  onOpenChange,
  doc,
  version,
  editor,
  pageLoadEligible,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  doc: LegalDocType;
  version: number;
  editor: EditorState;
  pageLoadEligible: number | null;
  busy: boolean;
  onConfirm: () => Promise<string | null>;
}) {
  const [live, setLive] = useState<{ state: "loading" } | { state: "ok"; count: number } | { state: "failed" }>({ state: "loading" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/admin/legal", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && typeof body?.eligibleUsers === "number") setLive({ state: "ok", count: body.eligibleUsers });
        else setLive({ state: "failed" });
      })
      .catch(() => {
        if (!cancelled) setLive({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function change(next: boolean) {
    if (!next) {
      setError(null);
      setLive({ state: "loading" });
    }
    onOpenChange(next);
  }

  async function confirm() {
    setError(null);
    const failure = await onConfirm();
    if (failure) setError(failure);
    else setLive({ state: "loading" });
  }

  const who =
    live.state === "ok"
      ? plural(live.count, "user is", "users are")
      : live.state === "loading"
        ? "Counting the users this affects…"
        : pageLoadEligible === null
          ? "The number of active users could not be counted just now."
          : `${plural(pageLoadEligible, "user was", "users were")} active when this page loaded (a live count failed).`;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            Publish version {version} of the {LEGAL_DOC_LABELS[doc]}?
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
            The version number is allocated when you publish. Older versions stay readable forever &mdash; that is what makes an acceptance
            record mean anything.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editor.requiresReacceptance ? (
            <Callout tone="error" title="Every user will be required to accept this before using the product">
              {live.state === "ok" ? `${who} active right now.` : who} Each of them is stopped at the acceptance screen on their next request
              until they accept version {version}.
            </Callout>
          ) : (
            <Callout tone="info" title="Nobody is interrupted">
              This is not marked as a material change. Existing users keep the version they accepted; new signups accept version {version}.
            </Callout>
          )}

          <KeyValues
            items={[
              { label: "Title", value: editor.title },
              { label: "Effective", value: legalDay(editor.effectiveDate) },
              { label: "Material change", value: editor.requiresReacceptance ? "Yes — everyone must accept" : "No" },
              { label: "Length", value: `${editor.content.trim().length.toLocaleString("en-US")} characters` },
            ]}
          />
          <div>
            <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">What changed</div>
            <p className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
              {editor.changeSummary.trim() || "No summary. Users are not told what changed."}
            </p>
          </div>

          {error && (
            <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => change(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={busy}>
            {busy ? "Publishing…" : `Publish version ${version}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── the escape hatch ──────────────────────────────────────────────────────────────────────── */

export function ClearDialog({
  target,
  doc,
  onClose,
  onCleared,
}: {
  target: AdminLegalVersion | null;
  doc: LegalDocType;
  onClose: () => void;
  onCleared: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (saving) return;
    setReason("");
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    if (reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    const result = await post({ action: "clear_reacceptance", documentId: target.id, reason: reason.trim() });
    setSaving(false);
    if (!result.ok) {
      setError(String(result.body?.error ?? "Could not clear it"));
      return;
    }
    notify.done("Cleared — nobody is blocked by this version any more.");
    setReason("");
    setError(null);
    onCleared();
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              Stop requiring acceptance of version {target?.version} of the {LEGAL_DOC_LABELS[doc]}?
            </DialogTitle>
            <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
              Use this if it was published by mistake. Nobody is blocked by it any more; the text is not changed or deleted, and people who
              already accepted keep their record. The reason is kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="legal-clear-reason" required error={error}>
            <textarea
              id="legal-clear-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              className={cn(control, "h-auto py-2")}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Clearing…" : "Stop requiring acceptance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── small pieces ──────────────────────────────────────────────────────────────────────────── */
