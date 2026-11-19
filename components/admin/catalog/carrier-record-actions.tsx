"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CarrierDeactivateDialog } from "@/components/admin/carrier-deactivate-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CarrierRow } from "@/lib/carriers/constants";
import { CARRIER_IN_USE_CODE, type CarrierBlockingUsage } from "@/lib/carriers/usage";
import { notify } from "@/lib/notify";

/**
 * The carrier record's title-line button (catalog.html screen 8): Deactivate… or Reactivate, through the same route
 * and guard as the list's switch. A carrier tenants use is refused and opens the in-use dialog, where a super admin
 * may deactivate it anyway with a recorded reason; a platform config admin is told why and who can.
 */
export function CarrierRecordActions({ carrier, canOverride }: { carrier: CarrierRow; canOverride: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<CarrierBlockingUsage | null | undefined>(undefined);

  async function setActive(isActive: boolean) {
    setBusy(true);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: isActive }) }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!isActive && response?.status === 409 && body?.code === CARRIER_IN_USE_CODE) {
      setBlocked(body.usage ?? null);
      return;
    }
    if (!response?.ok) {
      notify.block(body?.error ?? (isActive ? "Could not reactivate carrier" : "Could not deactivate carrier"));
      return;
    }
    notify.done(`${carrier.name} ${isActive ? "reactivated" : "deactivated"}`);
    router.refresh();
  }

  if (!carrier.is_active) {
    return <Button type="button" variant="outline" disabled={busy} onClick={() => void setActive(true)}>{busy ? "Reactivating…" : "Reactivate"}</Button>;
  }

  return (
    <>
      <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={busy} onClick={() => setConfirming(true)}>Deactivate…</Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void setActive(false)}
        busy={busy}
        title={`Deactivate ${carrier.name}?`}
        description="It leaves every tenant's carrier pickers. If tenants still use it, you will see who first. Nothing is deleted; reactivating brings it all back."
        confirmLabel="Deactivate carrier"
        cancelLabel="Keep it active"
      />
      <CarrierDeactivateDialog
        key={blocked === undefined ? "closed" : "open"}
        carrier={blocked === undefined ? null : carrier}
        usage={blocked ?? null}
        canOverride={canOverride}
        onClose={() => setBlocked(undefined)}
        onDeactivated={(name) => {
          setBlocked(undefined);
          notify.done(`${name} deactivated`);
          router.refresh();
        }}
      />
    </>
  );
}
