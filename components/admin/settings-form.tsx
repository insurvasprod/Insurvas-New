"use client";

import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  settingGroups,
  settingRefusalReason,
  type SettingDef,
  type SettingValue,
} from "@/lib/settings/constants";

export type SettingState = {
  key: string;
  value: SettingValue;
  isOverridden: boolean;
  updatedAt: string | null;
};

/**
 * One row per setting, each saving on its own.
 *
 * Not a single form with one Save: SA-4.3 requires every section to save independently, and a
 * whole-form submit means one refused value discards three good ones.
 */
export function SettingsForm({ initial }: { initial: SettingState[] }) {
  const [live, setLive] = useState<Record<string, SettingValue>>(
    Object.fromEntries(initial.map((s) => [s.key, s.value])),
  );
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [s.key, String(s.value)])),
  );
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const overridden = new Set(initial.filter((s) => s.isOverridden).map((s) => s.key));

  async function save(def: SettingDef) {
    const raw = draft[def.key];

    // Validated with the same function the API uses, so the form can never accept something the
    // server refuses — or refuse something it would have taken.
    const refusal = settingRefusalReason(def, raw);
    if (refusal) {
      setErrors((e) => ({ ...e, [def.key]: refusal }));
      return;
    }

    setBusy(def.key);
    setErrors((e) => ({ ...e, [def.key]: null }));

    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: def.key, value: raw }),
    });
    const body = await res.json().catch(() => null);
    setBusy(null);

    if (!res.ok) {
      // The typed value stays in the field — a refused save must never discard what was entered.
      setErrors((e) => ({ ...e, [def.key]: body?.error ?? "Could not save this setting." }));
      return;
    }

    setLive((v) => ({ ...v, [def.key]: body.value }));
    setDraft((d) => ({ ...d, [def.key]: String(body.value) }));
    toast.success(body.changed ? `${def.label} saved` : `${def.label} is already that`);
  }

  function reset(def: SettingDef) {
    setDraft((d) => ({ ...d, [def.key]: String(def.default) }));
    setErrors((e) => ({ ...e, [def.key]: null }));
  }

  return (
    <div className="space-y-6">
      {settingGroups().map(({ group, defs }) => (
        <Card key={group}>
          <CardContent className="space-y-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">{group}</h2>

            {defs.map((def) => {
              const dirty = draft[def.key] !== String(live[def.key]);
              const error = errors[def.key];
              const errorId = `${def.key}-error`;

              return (
                <div key={def.key} className="space-y-1.5 border-t border-border pt-4 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Label htmlFor={def.key}>{def.label}</Label>
                    <code className="text-[11px] text-muted-foreground">{def.key}</code>
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    {def.type === "select" ? (
                      <Select
                        value={draft[def.key]}
                        onValueChange={(v) => setDraft((d) => ({ ...d, [def.key]: v }))}
                      >
                        <SelectTrigger id={def.key} className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {def.options?.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          id={def.key}
                          className="w-52"
                          inputMode={def.type === "number" ? "numeric" : "text"}
                          value={draft[def.key]}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? errorId : undefined}
                          onChange={(e) => setDraft((d) => ({ ...d, [def.key]: e.target.value }))}
                        />
                        {def.unit && <span className="text-sm text-muted-foreground">{def.unit}</span>}
                      </div>
                    )}

                    <Button size="sm" onClick={() => save(def)} disabled={!dirty || busy === def.key}>
                      {busy === def.key ? "Saving…" : "Save"}
                    </Button>

                    {String(live[def.key]) !== String(def.default) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => reset(def)}
                        title={`Restore the default (${def.default})`}
                      >
                        <RotateCcw className="size-3.5" />
                        Default
                      </Button>
                    )}

                    {overridden.has(def.key) && !dirty && (
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                        <Check className="size-3.5" />
                        Overridden
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">{def.help}</p>

                  {error && (
                    <p id={errorId} className="text-xs font-medium text-[var(--color-danger)]">
                      {error}
                    </p>
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
