"use client";

import { useState, type FormEvent } from "react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btn, Callout, control, Field } from "@/components/app/settings/primitives";
import type { CarrierRow } from "@/lib/carriers/constants";
import {
  blockingSentence,
  DEACTIVATION_CONSEQUENCES,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REASON_MIN,
  type CarrierBlockingUsage,
} from "@/lib/carriers/usage";
import { cn } from "@/lib/utils";

/**
 * Shown when a carrier tenants use is deactivated (user decision: blocked, super admin may override
 * with a reason). The counts are the ones the route's guard returned with its 409. A super admin
 * gets the reason field and a confirm; anyone else is told why it is blocked and who can do it.
 */
export function CarrierDeactivateDialog({
  carrier,
  usage,
  canOverride,
  onClose,
  onDeactivated,
}: {
  carrier: CarrierRow | null;
  usage: CarrierBlockingUsage | null;
  canOverride: boolean;
  onClose: () => void;
  onDeactivated: (name: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const reasonOk = trimmed.length >= OVERRIDE_REASON_MIN && trimmed.length <= OVERRIDE_REASON_MAX;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!carrier || !reasonOk) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false, override_reason: trimmed }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      setError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    onDeactivated(carrier.name);
  }

  return (
    <Dialog open={Boolean(carrier)} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        {carrier && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Deactivate {carrier.name}?</DialogTitle>
              <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
                {usage ? blockingSentence(carrier.name, usage) : `Tenants still use ${carrier.name}.`}{" "}
                {canOverride
                  ? "It can only be deactivated with a reason, which is recorded in the audit log."
                  : "Only a super admin can deactivate a carrier tenants use."}
              </DialogDescription>
            </DialogHeader>

            <Callout tone="warning" title="What deactivating does to those tenants">
              <ul className="m-0 list-disc space-y-1 pl-5">
                {DEACTIVATION_CONSEQUENCES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Callout>

            {canOverride && (
              <Field
                label="Reason"
                htmlFor="carrier-deactivate-reason"
                required
                hint={`${OVERRIDE_REASON_MIN}–${OVERRIDE_REASON_MAX} characters. Recorded in the audit log for good.`}
              >
                <textarea
                  id="carrier-deactivate-reason"
                  required
                  rows={3}
                  minLength={OVERRIDE_REASON_MIN}
                  maxLength={OVERRIDE_REASON_MAX}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Carrier withdrew from the market on 1 Oct; agencies notified"
                  className={cn(control, "h-auto py-2")}
                />
              </Field>
            )}

            {error && (
              <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                {error}
              </p>
            )}

            <DialogFooter>
              <button type="button" onClick={onClose} disabled={saving} className={btn("ghost")}>
                {canOverride ? "Cancel" : "Close"}
              </button>
              {canOverride && (
                <button
                  type="submit"
                  disabled={saving || !reasonOk}
                  title={!reasonOk ? `Give a reason of at least ${OVERRIDE_REASON_MIN} characters` : undefined}
                  className={cn(btn("primary"), "bg-[var(--error)] text-[var(--on-error)] hover:bg-[var(--error-ink)]")}
                >
                  {saving ? "Deactivating…" : "Deactivate anyway"}
                </button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
