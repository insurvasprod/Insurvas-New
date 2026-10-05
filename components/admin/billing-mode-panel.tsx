"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function BillingModePanel({ tenantId, mode }: { tenantId: string; mode: "automatic" | "manual" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchTo(next: "automatic" | "manual") {
    setBusy(true);
    const res = await fetch(`/api/admin/tenants/${tenantId}/billing-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      notify.block(body?.error ?? "Could not change billing mode");
      return;
    }

    if (body.warning) notify.warn(body.warning);
    else notify.done(next === "manual" ? "Switched to manual billing" : "Automatic billing resumed");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Billing mode</h2>
          <StatusChip tone={mode === "manual" ? "warning" : "good"}>
            {mode === "manual" ? "Manual" : "Automatic"}
          </StatusChip>
        </div>

        <p className="text-sm text-muted-foreground">
          {mode === "manual"
            ? "The provider membership is paused, so no card is charged. Access continues, and they are billed by invoice."
            : "The provider charges their card automatically each period."}
        </p>

        <Button
          variant="outline"
          disabled={busy}
          onClick={() => switchTo(mode === "manual" ? "automatic" : "manual")}
        >
          {mode === "manual" ? "Resume automatic billing" : "Switch to manual billing"}
        </Button>
      </CardContent>
    </Card>
  );
}
