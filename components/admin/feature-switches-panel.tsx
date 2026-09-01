"use client";

import { useState } from "react";
import { CircleCheck, CircleSlash, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SWITCH_STATES,
  SWITCH_STATE_HELP,
  SWITCH_STATE_LABELS,
  switchRefusalReason,
  OFF_MESSAGE_MAX,
  type FeatureSwitch,
  type SwitchState,
} from "@/lib/features/killSwitchRules";

export type SwitchableFeature = {
  featureKey: string;
  label: string;
  module: string;
  moduleLabel: string;
};

type Draft = { state: SwitchState; betaIds: string; offMessage: string; reason: string };

const STATE_ICON: Record<SwitchState, typeof CircleCheck> = {
  on: CircleCheck,
  off: CircleSlash,
  beta: Users,
};

const STATE_TONE: Record<SwitchState, string> = {
  on: "text-[var(--color-success)]",
  off: "text-[var(--color-danger)]",
  beta: "text-[var(--color-warning)]",
};

export function FeatureSwitchesPanel({
  features,
  initialSwitches,
}: {
  features: SwitchableFeature[];
  initialSwitches: FeatureSwitch[];
}) {
  const [live, setLive] = useState<Record<string, FeatureSwitch>>(
    Object.fromEntries(initialSwitches.map((s) => [s.feature_key, s])),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function stateOf(key: string): SwitchState {
    return live[key]?.state ?? "on";
  }

  function edit(key: string) {
    const current = live[key];
    setOpen(key);
    setError(null);
    setDraft({
      state: current?.state ?? "on",
      betaIds: (current?.beta_tenant_ids ?? []).join("\n"),
      offMessage: current?.off_message ?? "",
      reason: "",
    });
  }

  async function save(key: string) {
    if (!draft) return;

    const betaTenantIds = draft.betaIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Validated with the same function the API uses, so the form cannot accept what the server
    // refuses — or refuse what it would have taken.
    const refusal = switchRefusalReason({
      state: draft.state,
      betaTenantIds,
      offMessage: draft.offMessage || null,
    });
    if (refusal) return setError(refusal);
    if (draft.reason.trim().length < 5) {
      return setError("Give a reason of at least 5 characters — this is what explains the change later.");
    }

    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/feature-switches", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_key: key,
        state: draft.state,
        beta_tenant_ids: betaTenantIds,
        off_message: draft.offMessage.trim() || null,
        reason: draft.reason.trim(),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);

    if (!res.ok) {
      // The draft stays on screen — a refused save must never discard what was typed.
      setError(body?.error ?? "Could not save this switch.");
      return;
    }

    setLive((v) => ({ ...v, [key]: body.featureSwitch }));
    setOpen(null);
    setDraft(null);
    toast.success(
      draft.state === "on" ? "Feature switched back on" : `Feature set to "${SWITCH_STATE_LABELS[draft.state]}"`,
    );
  }

  const byModule = features.reduce<Record<string, { moduleLabel: string; items: SwitchableFeature[] }>>(
    (acc, f) => {
      acc[f.module] ??= { moduleLabel: f.moduleLabel, items: [] };
      acc[f.module].items.push(f);
      return acc;
    },
    {},
  );

  const killedCount = features.filter((f) => stateOf(f.featureKey) !== "on").length;

  return (
    <div className="space-y-6">
      <div
        className={`rounded-lg border p-4 text-sm ${
          killedCount > 0
            ? "border-[var(--color-warning)]/50 bg-[var(--color-warning)]/5"
            : "border-border bg-card"
        }`}
      >
        {killedCount > 0 ? (
          <p>
            <span className="font-semibold">
              {killedCount} feature{killedCount === 1 ? " is" : "s are"} not fully on.
            </span>{" "}
            A switched-off feature is unreachable for every tenant, including those whose plan includes
            it. Entitlements are unaffected — nobody has lost anything they paid for.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Every feature is on. Switching one off takes it away from all tenants at once, whatever
            their plan says — use it for an incident, not for packaging.
          </p>
        )}
      </div>

      {Object.entries(byModule).map(([moduleKey, group]) => (
        <Card key={moduleKey}>
          <CardContent className="space-y-1">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">
              {group.moduleLabel}
            </h2>

            {group.items.map((f) => {
              const state = stateOf(f.featureKey);
              const Icon = STATE_ICON[state];
              const isOpen = open === f.featureKey;

              return (
                <div key={f.featureKey} className="border-t border-border py-3 first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className={`size-4 shrink-0 ${STATE_TONE[state]}`} />
                        <span className="font-medium">{f.label}</span>
                        {state !== "on" && (
                          <Badge variant="outline" className="text-[10px]">
                            {SWITCH_STATE_LABELS[state]}
                          </Badge>
                        )}
                      </div>
                      <code className="text-[11px] text-muted-foreground">{f.featureKey}</code>
                    </div>

                    <Button variant="ghost" size="sm" onClick={() => (isOpen ? setOpen(null) : edit(f.featureKey))}>
                      {isOpen ? "Cancel" : "Change"}
                    </Button>
                  </div>

                  {isOpen && draft && (
                    <div className="mt-3 space-y-3 rounded-md border border-border bg-[var(--color-page-bg)] p-3">
                      <div className="flex flex-wrap gap-2">
                        {SWITCH_STATES.map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={draft.state === s ? "default" : "outline"}
                            onClick={() => setDraft({ ...draft, state: s })}
                          >
                            {SWITCH_STATE_LABELS[s]}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{SWITCH_STATE_HELP[draft.state]}</p>

                      {draft.state === "beta" && (
                        <div className="space-y-1">
                          <Label htmlFor={`beta-${f.featureKey}`}>Tenant IDs, one per line</Label>
                          <textarea
                            id={`beta-${f.featureKey}`}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                            value={draft.betaIds}
                            onChange={(e) => setDraft({ ...draft, betaIds: e.target.value })}
                          />
                        </div>
                      )}

                      {draft.state !== "on" && (
                        <div className="space-y-1">
                          <Label htmlFor={`msg-${f.featureKey}`}>Message shown to agents (optional)</Label>
                          <Input
                            id={`msg-${f.featureKey}`}
                            maxLength={OFF_MESSAGE_MAX}
                            placeholder="Dialing is unavailable while we switch DNC providers."
                            value={draft.offMessage}
                            onChange={(e) => setDraft({ ...draft, offMessage: e.target.value })}
                          />
                          <p className="text-xs text-muted-foreground">
                            Leave empty to say nothing beyond &ldquo;temporarily unavailable&rdquo;.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label htmlFor={`why-${f.featureKey}`}>Why (required, audit-logged)</Label>
                        <Input
                          id={`why-${f.featureKey}`}
                          placeholder="DNC vendor outage, incident #412"
                          value={draft.reason}
                          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                        />
                      </div>

                      {error && <p className="text-xs font-medium text-[var(--color-danger)]">{error}</p>}

                      <Button size="sm" onClick={() => save(f.featureKey)} disabled={busy}>
                        {busy ? "Saving…" : "Apply"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
