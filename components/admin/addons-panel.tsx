"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { AddonRow, AttachedAddon } from "@/lib/addons/constants";

export function AddonsPanel({
  subscriptionId,
  subscriptionCycle,
  attached,
  catalog,
  availableAddonIds,
}: {
  subscriptionId: string | null;
  subscriptionCycle: BillingCycle | null;
  attached: AttachedAddon[];
  catalog: AddonRow[];
  availableAddonIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  if (!subscriptionId || !subscriptionCycle) return null;

  const attachedIds = new Set(attached.map((a) => a.addon_id));
  const available = new Set(availableAddonIds);

  // Only add-ons on the same billing cycle can be attached, so mismatches never reach the API.
  const attachable = catalog.filter(
    (a) => a.is_active && !attachedIds.has(a.id) && a.billing_cycle === subscriptionCycle,
  );

  const selectedAddon = catalog.find((a) => a.id === selected);
  const needsOverride = selectedAddon ? !available.has(selectedAddon.id) : false;

  async function attach() {
    if (!selectedAddon) return;
    setBusy(true);

    const res = await fetch(`/api/admin/subscriptions/${subscriptionId}/addons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addon_id: selectedAddon.id, override_availability: needsOverride }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not attach the add-on");
      return;
    }

    toast.success(`${selectedAddon.name} attached`);
    setSelected("");
    router.refresh();
  }

  async function detach(item: AttachedAddon) {
    setBusy(true);
    const res = await fetch(`/api/admin/subscriptions/${subscriptionId}/addons`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_addon_id: item.id }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not detach the add-on");
      return;
    }

    toast.success(`${item.name} detached`);
    router.refresh();
  }

  const monthlyTotal = attached.reduce((sum, a) => sum + a.price_cents, 0);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Add-ons</h2>
          {attached.length > 0 && (
            <span className="text-sm text-muted-foreground">
              +{formatCentsAsCurrency(monthlyTotal)} / {BILLING_CYCLE_LABELS[subscriptionCycle].toLowerCase()}
            </span>
          )}
        </div>

        {attached.length === 0 ? (
          <p className="text-sm text-muted-foreground">None attached.</p>
        ) : (
          <div className="space-y-2">
            {attached.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">{formatCentsAsCurrency(item.price_cents)}</span>
                  {item.availability_overridden && (
                    <Badge
                      variant="outline"
                      className="border-transparent bg-[var(--color-warning)]/10 text-[10px] text-[var(--color-warning)]"
                      title="Attached despite not being offered by this plan"
                    >
                      Off-plan
                    </Badge>
                  )}
                </span>
                <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => detach(item)}>
                  <X />
                  <span className="sr-only">Detach {item.name}</span>
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="min-w-[220px] flex-1">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={attachable.length ? "Add an add-on…" : "Nothing available to attach"} />
              </SelectTrigger>
              <SelectContent>
                {attachable.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} — {formatCentsAsCurrency(a.price_cents)}
                    {!available.has(a.id) && " · not on this plan"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={busy || !selected} onClick={attach}>
            {needsOverride ? "Attach anyway" : "Attach"}
          </Button>
        </div>

        {needsOverride && (
          <p className="text-xs text-[var(--color-warning)]">
            This plan doesn&apos;t offer that add-on. Attaching records an override in the audit log.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
