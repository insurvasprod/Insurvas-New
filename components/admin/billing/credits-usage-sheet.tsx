"use client";

import Link from "next/link";
import { useState } from "react";

import { usageState } from "@/components/admin/billing/credits-usage";
import { SettingsMeter } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { forecastHit, forecastLabel, type MonitorEntry } from "@/lib/creditsLimits/present";
import { utcDay } from "@/lib/coupons/format";
import { notify } from "@/lib/notify";

const count = (value: number) => value.toLocaleString("en-US");
const SECTION = "flex flex-col gap-2 border-t border-border pt-4";

type Preview = { to: string; subject: string; text: string; delivery: "on" | "off" };

/**
 * One customer's limit as a right sheet (admin round 1, billing-r2 screen 10): where it stands, when this month's pace
 * reaches it, and the three things to do about it — grant credits, add a pack to an invoice, or email the owner. The
 * email is previewed first (GET /api/admin/credits-limits/email-owner) and sent only on a second, explicit press.
 */
export function CreditsUsageSheet({ entry, now, canAddPack, onClose, onGrant, onAddPack }: {
  entry: MonitorEntry;
  now: Date;
  /** A pack with a price is on sale. */
  canAddPack: boolean;
  onClose: () => void;
  onGrant: () => void;
  onAddPack: () => void;
}) {
  const chip = usageState(entry);
  const forecast = forecastHit(entry, now);
  const meter = entry.kind === "seats" ? "seats" : entry.key.slice(entry.tenantId.length + 1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setEmailError(null);
    const response = await fetch(`/api/admin/credits-limits/email-owner?tenant_id=${encodeURIComponent(entry.tenantId)}&meter=${encodeURIComponent(meter)}`).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      setEmailError(body?.error ?? "The email could not be prepared.");
      return;
    }
    setPreview(body as Preview);
  }

  async function send() {
    setBusy(true);
    setEmailError(null);
    const response = await fetch("/api/admin/credits-limits/email-owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: entry.tenantId, meter }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      setEmailError(body?.error ?? "The email could not be sent.");
      return;
    }
    if (body?.sent) notify.done(body.message ?? "Owner emailed");
    else notify.warn(body?.message ?? "Recorded but not sent");
    setSentNote(body?.message ?? null);
    setPreview(null);
  }

  return (
    <Sheet
      title={entry.tenantName}
      subtitle={entry.label}
      status={<StatusChip tone={chip.tone} dot>{chip.label}</StatusChip>}
      onClose={onClose}
      footer={<>
        <Link href={`/admin/tenants/${entry.tenantId}`} className="text-sm text-[var(--accent-ink)] hover:underline">Open the customer</Link>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </>}
    >
      <SettingsMeter value={entry.used} max={entry.limit} tone={entry.state === "over" ? "error" : entry.state === "near" ? "warning" : "success"} ariaLabel={`${count(entry.used)} of ${count(entry.limit)}`} />
      <FactTable
        rows={[
          ["Used", `${count(entry.used)} of ${count(entry.limit)}`],
          ["Hits the limit", forecast.kind === "none" ? (entry.kind === "seats" ? "Seats do not run out over a month" : "No use this period yet") : forecastLabel(forecast)],
          ["From add-ons", entry.addonQty > 0 ? count(entry.addonQty) : null],
          ["Granted this period", entry.grantQty > 0 ? count(entry.grantQty) : null],
          ["Period began", entry.periodStart ? utcDay(entry.periodStart) : null],
          ["Customer status", entry.tenantStatus !== "active" ? entry.tenantStatus : null],
        ]}
      />

      <section className={SECTION}>
        <h3 className="m-0 text-sm font-semibold text-foreground">Raise the limit</h3>
        {entry.grantMeter ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onGrant}>Grant credits…</Button>
            <Button type="button" variant="outline" size="sm" onClick={onAddPack} disabled={!canAddPack} title={canAddPack ? undefined : "No pack with a price is on sale"}>Add a pack to an invoice…</Button>
          </div>
        ) : (
          <p className="m-0 text-xs text-muted-foreground">{entry.kind === "seats" ? "Seats come from the plan; change the plan to raise them." : "Credits cannot be granted on this meter."}</p>
        )}
      </section>

      <section className={SECTION}>
        <h3 className="m-0 text-sm font-semibold text-foreground">Email the owner</h3>
        {entry.state === "ok" ? (
          <p className="m-0 text-xs text-muted-foreground">Offered once the customer is near or past the limit.</p>
        ) : preview ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-muted-foreground">To {preview.to} · {preview.subject}{preview.delivery === "off" ? " · email delivery is off here, so it would be recorded but not sent" : ""}</p>
            <pre className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-[var(--surface-alt)] p-3 font-sans text-xs text-foreground">{preview.text}</pre>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void send()} disabled={busy}>{busy ? "Sending…" : "Send to the owner"}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-xs text-muted-foreground">Tells the owner how much is used, when it runs out at this pace, and how to add more. At most once a day per limit.</p>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void prepare()} disabled={busy}>{busy ? "Preparing…" : "Preview the email…"}</Button>
          </div>
        )}
        {sentNote && <p className="m-0 text-xs text-muted-foreground" role="status">{sentNote}</p>}
        {emailError && <p className="m-0 text-xs text-[var(--error-ink)]" role="alert">{emailError}</p>}
      </section>
    </Sheet>
  );
}
