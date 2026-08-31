"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SIMULATED_OUTCOMES,
  SIMULATED_OUTCOME_HINTS,
  SIMULATED_OUTCOME_LABELS,
  isDummyProvider,
  type ProviderCallRow,
  type ProviderSettingRow,
  type SimulatedOutcome,
  type TenantPaymentProvider,
} from "@/lib/payments/constants";

const CALL_STATUS_STYLES: Record<string, string> = {
  ok: "text-[var(--color-success)]",
  declined: "text-[var(--color-warning)]",
  timeout: "text-[var(--color-warning)]",
  error: "text-destructive",
};

export function PaymentProviderPanel({
  tenantId,
  record,
  settings,
  calls,
  platformDefault,
}: {
  tenantId: string;
  record: TenantPaymentProvider | null;
  settings: ProviderSettingRow[];
  calls: ProviderCallRow[];
  platformDefault: string | null;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(record?.provider ?? platformDefault ?? "");
  const [label, setLabel] = useState(record?.payment_method_label ?? "");
  const [busy, setBusy] = useState(false);

  const selectable = settings.filter((s) => s.is_enabled || s.provider === record?.provider);
  const dirty = provider !== (record?.provider ?? "") || label !== (record?.payment_method_label ?? "");

  async function save() {
    if (!provider) return;
    setBusy(true);

    const res = await fetch(`/api/admin/tenants/${tenantId}/payment-provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, payment_method_label: label.trim() || undefined }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not set the payment provider");
      return;
    }

    toast.success("Payment provider saved");
    router.refresh();
  }

  async function setOutcome(outcome: SimulatedOutcome) {
    setBusy(true);
    const res = await fetch(`/api/admin/tenants/${tenantId}/payment-provider`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulate_outcome: outcome }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not update the simulator");
      return;
    }

    toast.success(
      outcome === "success" ? "Simulator cleared — charges succeed" : `Charges will now ${SIMULATED_OUTCOME_LABELS[outcome].toLowerCase()}`,
    );
    router.refresh();
  }

  const armed = record ? record.simulate_outcome !== "success" : false;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Payment provider</h2>
          {!record && platformDefault && (
            <span className="text-sm text-muted-foreground">
              Using the platform default ({platformDefault})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="provider" className="w-full">
                <SelectValue placeholder="Choose a provider…" />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((s) => (
                  <SelectItem key={s.provider} value={s.provider}>
                    {s.display_label}
                    {s.is_default && " · platform default"}
                    {!s.is_enabled && " · disabled"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="method-label">Payment method</Label>
            <Input
              id="method-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Visa •••• 4242"
            />
          </div>

          <Button size="sm" disabled={busy || !provider || !dirty} onClick={save}>
            Save
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          A display label only. Card numbers are never stored here, or anywhere else in this system.
        </p>

        {record?.provider_customer_id && (
          <p className="text-sm">
            <span className="text-muted-foreground">Customer at provider: </span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{record.provider_customer_id}</code>
          </p>
        )}

        {record && isDummyProvider(record.provider) && (
          <div className="space-y-2 rounded-md border border-dashed border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Failure simulator</span>
              {armed && (
                <Badge
                  variant="outline"
                  className="border-transparent bg-[var(--color-warning)]/10 text-[10px] text-[var(--color-warning)]"
                >
                  Armed
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={record.simulate_outcome}
                onValueChange={(value) => setOutcome(value as SimulatedOutcome)}
                disabled={busy}
              >
                <SelectTrigger className="min-w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIMULATED_OUTCOMES.map((outcome) => (
                    <SelectItem key={outcome} value={outcome}>
                      {SIMULATED_OUTCOME_LABELS[outcome]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              {SIMULATED_OUTCOME_HINTS[record.simulate_outcome]} Sticky until set back to “Succeed”, so this
              tenant can walk the whole dunning ladder.
            </p>
          </div>
        )}

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium">Recent provider calls</p>
          {calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls yet.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {calls.map((call) => (
                <li key={call.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{new Date(call.ts).toLocaleString()}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5">{call.method}</code>
                  <span className={CALL_STATUS_STYLES[call.status] ?? ""}>{call.status}</span>
                  {call.duration_ms !== null && <span className="text-muted-foreground">{call.duration_ms}ms</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
