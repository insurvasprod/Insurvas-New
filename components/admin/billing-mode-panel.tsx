"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
      toast.error(body?.error ?? "Could not change billing mode");
      return;
    }

    if (body.warning) toast.warning(body.warning);
    else toast.success(next === "manual" ? "Switched to manual billing" : "Automatic billing resumed");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Billing mode</h2>
          <Badge
            variant="outline"
            className={
              mode === "manual"
                ? "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                : "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]"
            }
          >
            {mode === "manual" ? "Manual" : "Automatic"}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          {mode === "manual"
            ? "The provider membership is paused, so no card is charged. Access continues, and they are billed by invoice."
            : "The provider charges their card automatically each period."}
        </p>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => switchTo(mode === "manual" ? "automatic" : "manual")}
        >
          {mode === "manual" ? "Resume automatic billing" : "Switch to manual billing"}
        </Button>
      </CardContent>
    </Card>
  );
}
