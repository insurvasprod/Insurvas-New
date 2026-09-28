"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btn, Callout, control, Field } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  confirmsTenantName,
  SUSPENSION_REASON_MAX,
  SUSPENSION_REASON_MIN,
  TENANT_SUSPENDED_MESSAGE,
} from "@/lib/tenants/suspension";

/** The header button at the default size. Danger is error-ink on white with the error edge. */
const DANGER = "border-[var(--error)] text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]";

/**
 * Suspend / Unsuspend in the tenant record's header (decision 4). Rendered only for super_admin —
 * the frame decides that on the server; the route checks it again.
 */
export function TenantSuspensionControl({
  tenantId,
  tenantName,
  suspended,
}: {
  tenantId: string;
  tenantName: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = suspended ? "unsuspend" : "suspend";
  const reasonOk = reason.trim().length >= SUSPENSION_REASON_MIN && reason.trim().length <= SUSPENSION_REASON_MAX;
  const nameOk = suspended || confirmsTenantName(confirmName, tenantName);

  function openDialog() {
    setReason("");
    setConfirmName("");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reasonOk || !nameOk) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/admin/tenants/${tenantId}/suspension`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason, ...(suspended ? {} : { confirmName }) }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setSaving(false);

    if (!response?.ok) {
      setError(body?.error ?? "Could not reach the server. Nothing was changed.");
      return;
    }
    notify.done(suspended ? `${tenantName} unsuspended` : `${tenantName} suspended`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openDialog} className={suspended ? undefined : DANGER}>
        {suspended ? "Unsuspend" : "Suspend"}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-[560px]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{suspended ? `Unsuspend ${tenantName}` : `Suspend ${tenantName}`}</DialogTitle>
              <DialogDescription className="text-[14px] leading-[1.5] tracking-[-0.02em]">
                {suspended
                  ? "Everyone in the agency can sign in again straight away, with the access they had before."
                  : "Everyone in this agency loses access until you unsuspend it."}
              </DialogDescription>
            </DialogHeader>

            {!suspended && (
              <Callout tone="warning" title="What happens">
                <ul className="m-0 list-disc space-y-1 pl-5">
                  <li>Everyone in the agency, the owner included, is signed out at their next action and cannot sign back in.</li>
                  <li>Partner portal users working for this agency are signed out too.</li>
                  <li>They see: &ldquo;{TENANT_SUSPENDED_MESSAGE}&rdquo; and nothing from the workspace.</li>
                  <li>
                    Billing is not touched. The subscription, its invoices and scheduled charges carry on, and the billing
                    jobs keep running. Pause or cancel the subscription separately if that is what you mean.
                  </li>
                  <li>No data is changed or deleted. Leads posted by API keep arriving.</li>
                </ul>
              </Callout>
            )}

            <Field
              label="Reason"
              htmlFor="tenant-suspension-reason"
              required
              hint={`${SUSPENSION_REASON_MIN}–${SUSPENSION_REASON_MAX} characters. Recorded in the audit log for good.`}
            >
              <textarea
                id="tenant-suspension-reason"
                required
                rows={3}
                minLength={SUSPENSION_REASON_MIN}
                maxLength={SUSPENSION_REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={suspended ? "e.g. Outstanding balance settled" : "e.g. Chargeback fraud under review"}
                className={cn(control, "h-auto py-2")}
              />
            </Field>

            {!suspended && (
              <Field
                label={
                  <>
                    Type <span className="font-mono">{tenantName}</span> to confirm
                  </>
                }
                htmlFor="tenant-suspension-confirm"
                required
              >
                <input
                  id="tenant-suspension-confirm"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  className={control}
                />
              </Field>
            )}

            {error && (
              <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                {error}
              </p>
            )}

            <DialogFooter>
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className={btn("ghost")}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !reasonOk || !nameOk}
                className={
                  suspended
                    ? btn("primary")
                    : cn(btn("primary"), "bg-[var(--error)] text-[var(--on-error)] hover:bg-[var(--error-ink)]")
                }
              >
                {saving ? (suspended ? "Unsuspending…" : "Suspending…") : suspended ? "Unsuspend agency" : "Suspend agency"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
