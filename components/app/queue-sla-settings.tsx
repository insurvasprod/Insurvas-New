"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Values = { warn: number; escalate: number; partner: number; expire: number };
const initial: Values = { warn: 45, escalate: 120, partner: 300, expire: 14400 };
const fields: Array<[keyof Values, string, string]> = [["warn", "Warn after", "Amber warning on Agent Floor"], ["escalate", "Escalate after", "Alert the tenant owner"], ["partner", "Partner notice after", "Tell the partner nobody claimed it"], ["expire", "Expire after", "Remove it from the active queue"]];

export function QueueSlaSettings() {
  const [values, setValues] = useState<Values>(initial); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/app/queue-sla-settings", { cache: "no-store" }).then(async (response) => { const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not load queue SLA settings"); setValues({ warn: body.settings.warn_after_seconds, escalate: body.settings.escalate_after_seconds, partner: body.settings.partner_notify_after_seconds, expire: body.settings.expire_after_seconds }); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load queue SLA settings")).finally(() => setLoading(false)); }, []);
  async function save() { setError(""); if (!(values.warn < values.escalate && values.escalate < values.partner && values.partner < values.expire)) { setError("Use increasing times: warn, escalate, partner notice, then expiry."); return; } setSaving(true); const response = await fetch("/api/app/queue-sla-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }); const body = await response.json().catch(() => null); setSaving(false); if (!response.ok) { setError(body?.error ?? "Could not save queue SLA settings"); return; } toast.success("Queue SLA settings saved"); }
  return <Card><CardHeader><CardTitle>Unclaimed lead response ladder</CardTitle><p className="text-sm text-muted-foreground">These tenant-specific thresholds drive the Agent Floor, alerts, partner notice, and expiry. Changes apply to the next scheduler run without a deploy.</p></CardHeader><CardContent className="space-y-4">{error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, help]) => <div key={key} className="space-y-2"><Label htmlFor={`sla-${key}`}>{label} (seconds)</Label><Input id={`sla-${key}`} type="number" min={1} value={loading ? "" : values[key]} disabled={loading || saving} onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))} aria-describedby={`sla-${key}-help`} /><p id={`sla-${key}-help`} className="text-xs text-muted-foreground">{help}</p></div>)}</div><Button type="button" onClick={() => void save()} disabled={loading || saving}>{saving ? "Saving…" : "Save response ladder"}</Button></CardContent></Card>;
}
