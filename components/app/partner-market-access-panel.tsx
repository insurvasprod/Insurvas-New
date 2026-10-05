"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, MapPin, ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Market = { carrier_id: string; carrier_name: string; state: string };
type Profile = {
  id: string;
  current_revision: number;
  markets: Array<{ carrier_id: string; state: string }>;
} | null;

export function PartnerMarketAccessPanel({
  partnerId,
  target,
  readOnly = false,
  compact = false,
}: {
  partnerId: string;
  target?: {
    userId: string;
    name: string;
    role: "partner_admin" | "partner_user";
  };
  readOnly?: boolean;
  compact?: boolean;
}) {
  const base = target
    ? `/api/app/partners/${partnerId}/users/${target.userId}/market-access`
    : `/api/app/partners/${partnerId}/market-access`;
  const [eligible, setEligible] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [source, setSource] = useState("tenant_appointments");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(base, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) notify.block(body?.error ?? "Could not load carrier access");
    else {
      const profile: Profile = target
        ? body.effective?.profile_id
          ? {
              id: body.effective.profile_id,
              current_revision: body.effective.revision ?? 0,
              markets: body.effective.markets ?? [],
            }
          : null
        : body.profile;
      const effective = target ? body.effective : null;
      const markets = target
        ? effective?.markets ?? []
        : profile?.markets ?? body.eligible ?? [];
      setEligible(body.eligible ?? []);
      setSelected(
        new Set(
          markets.map(
            (market: { carrier_id: string; state: string }) =>
              `${market.carrier_id}:${market.state}`,
          ),
        ),
      );
      setSource(
        target
          ? effective?.source ?? "tenant_appointments"
          : body.source ?? "tenant_appointments",
      );
    }
    setLoading(false);
  }, [base, target]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const states = useMemo(
    () => [...new Set(eligible.map((market) => market.state))].sort(),
    [eligible],
  );
  const carriers = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; states: Set<string> }>();
    for (const market of eligible) {
      const current = byId.get(market.carrier_id) ?? {
        id: market.carrier_id,
        name: market.carrier_name,
        states: new Set<string>(),
      };
      current.states.add(market.state);
      byId.set(market.carrier_id, current);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible]);
  const eligibleKeys = useMemo(
    () => new Set(eligible.map((market) => `${market.carrier_id}:${market.state}`)),
    [eligible],
  );

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const markets = eligible
      .filter((market) => selected.has(`${market.carrier_id}:${market.state}`))
      .map(({ carrier_id, state }) => ({ carrier_id, state }));
    const response = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markets }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(body?.error ?? "Could not save carrier access");
    notify.done("Carrier and state access published");
    await load();
  }

  if (loading)
    return (
      <Card className={cn(compact && "border-0 shadow-none")}>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Loading carrier and state access…
        </CardContent>
      </Card>
    );

  return (
    <Card className={cn(compact && "border-0 shadow-none")}>
      <CardHeader
        className={cn("border-b bg-muted/10", compact && "px-0 pb-3 pt-0")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-[var(--color-blue)]" />
              Carrier &amp; State access
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Select multiple carriers and states for this configuration. Only
              active appointment pairs can be selected.
            </p>
          </div>
          <StatusChip>
            {source === "tenant_appointments"
              ? "Active appointments"
              : `Inherited from ${source.replace("_", " ")}`}
          </StatusChip>
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4 p-4", compact && "p-0 pt-3")}>
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-blue)]/20 bg-[var(--color-blue-faint)] p-3 text-xs text-[var(--color-accent-ink)]">
          <MapPin className="mt-0.5 size-4 shrink-0" />
          <p>
            Partners must select <strong>Product, Carrier, and State</strong>
            before submitting. The Partner Portal receives only the pairs saved
            here.
          </p>
        </div>
        {eligible.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Carrier</th>
                  <th className="px-3 py-2 font-medium">Appointment</th>
                  {states.map((state) => (
                    <th key={state} className="px-2 py-2 text-center font-medium">
                      {state}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {carriers.map((carrier) => (
                  <tr key={carrier.id}>
                    <th className="px-3 py-3 font-medium">{carrier.name}</th>
                    <td className="px-3 py-3">
                      <StatusChip tone="good">Active</StatusChip>
                    </td>
                    {states.map((state) => {
                      const key = `${carrier.id}:${state}`;
                      const available = eligibleKeys.has(key);
                      const checked = selected.has(key);
                      return (
                        <td key={state} className="px-2 py-2 text-center">
                          {available ? (
                            <label
                              className={cn(
                                "mx-auto flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors",
                                checked
                                  ? "border-[var(--color-orange)] bg-[var(--color-orange-faint)] text-[var(--color-orange)]"
                                  : "border-input hover:bg-muted/50",
                              )}
                              title={`${carrier.name} in ${state}`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={checked}
                                disabled={readOnly}
                                onChange={() => toggle(key)}
                              />
                              {checked ? <Check className="size-4" /> : null}
                            </label>
                          ) : (
                            <span
                              className="text-muted-foreground/50"
                              title="No active appointment for this pair"
                            >
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active carrier appointments are available. Add agency contracts
            and appointments before granting access.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {selected.size} carrier/state pair{selected.size === 1 ? "" : "s"} selected
          </p>
          <Button
            type="button"
            disabled={readOnly || saving || !eligible.length}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save carrier & state access"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
