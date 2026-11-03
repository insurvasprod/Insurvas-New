"use client";

/**
 * "Record counteroffer" (LA-3.26): the carrier approved different terms. Recorded beside the
 * original application, which is never overwritten; it raises a waiting-on-client requirement and
 * moves the attempt to counteroffer_pending. Figures are typed off the carrier's notice in dollars
 * and stored as integer cents.
 */

import { useState, type FormEvent } from "react";

import { Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { FE_TIERS, TIER_LABEL } from "@/lib/applications/constants";
import type { CounterofferView } from "@/lib/applications/types";
import { parseDollarsToCents } from "@/lib/money";
import { notify } from "@/lib/notify";

import { face, money } from "@/components/app/applications/parts";
import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { appliedOf, dateInput, DAY_MS, tierName } from "./model";

export function CounterofferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <CounterofferForm open={open} onOpenChange={onOpenChange} /> : null;
}

const asDollars = (cents: number) => (cents ? (cents / 100).toFixed(2).replace(/\.00$/, "") : "");

function CounterofferForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { attempt, sample, actions, updateAttempt } = useWorkspace();
  const applied = appliedOf(attempt);
  const [today] = useState(() => Date.now());
  const [tier, setTier] = useState<string>(applied.tier === "level" ? "graded" : applied.tier ?? "graded");
  const [healthClass, setHealthClass] = useState(applied.healthClass ?? "");
  const [faceText, setFaceText] = useState(asDollars(applied.faceCents));
  const [monthlyText, setMonthlyText] = useState("");
  const [annualText, setAnnualText] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(() => dateInput(today + 7 * DAY_MS));
  const [appliedEffective, setAppliedEffective] = useState("");
  const [offeredEffective, setOfferedEffective] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  const faceCents = parseDollarsToCents(faceText);
  const monthlyCents = parseDollarsToCents(monthlyText);
  const annualCents = annualText.trim() ? parseDollarsToCents(annualText) : null;
  const errors = {
    face: !faceCents || faceCents <= 0 ? "Enter the face amount the carrier offered." : undefined,
    monthly: !monthlyCents || monthlyCents <= 0 ? "Enter the monthly premium the carrier offered." : faceCents && monthlyCents >= faceCents ? "The premium can't be as much as the face amount." : undefined,
    annual: annualText.trim() && (!annualCents || annualCents <= 0) ? "Enter the annual premium in dollars, or leave it empty." : undefined,
    reason: !reason.trim() ? "Say why — it's what you'll tell the client." : undefined,
    expires: !expires ? "Enter when the offer expires." : expires <= dateInput(today) ? "The offer has to expire after today." : undefined,
  };
  const show = (key: keyof typeof errors) => (tried ? errors[key] : undefined);

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean) || !faceCents || !monthlyCents || saving) return;
    const expiresAt = new Date(`${expires}T23:59:00`).toISOString();
    if (sample) {
      const offer: CounterofferView = { id: `co-${crypto.randomUUID()}`, receivedAt: new Date().toISOString(), applied, offered: { tier, healthClass: healthClass.trim() || null, faceCents, monthlyCents }, reason: reason.trim(), expiresAt, status: "pending_client" };
      updateAttempt({ status: "counteroffer_pending", counteroffers: [...attempt.counteroffers, offer] });
      notify.done("Sample data — nothing was saved");
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const r = await request<{ id: string }>(attemptUrl(attempt.id, "/counteroffers"), {
        method: "POST",
        body: {
          offered_tier: tier, offered_health_class: healthClass.trim() || null, offered_face_cents: faceCents, offered_monthly_premium_cents: monthlyCents,
          offered_annual_premium_cents: annualCents, reason_text: reason.trim(), expires_at: expiresAt,
          applied_effective_on: appliedEffective || null, offered_effective_on: offeredEffective || null,
        },
      });
      if (!r.ok) { notify.block(r.error, { detail: "What you typed is still in the form." }); return; }
      await actions.refresh();
      notify.done("Counteroffer recorded", { detail: "It's on the requirements list, waiting on the client." });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!saving) onOpenChange(o); }}
      width={720}
      title="Record counteroffer"
      subtitle={`Applied for ${tierName(applied.tier)} · ${face(applied.faceCents)} · ${money(applied.monthlyCents)} a month${attempt.carrierName ? ` with ${attempt.carrierName}` : ""}`}
      onSubmit={save}
      footerNote="The original application and quote are kept exactly as they are."
      actions={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} title={saving ? "Saving…" : undefined}>Cancel</Button>
        <Button type="submit" disabled={saving} title={saving ? "Saving…" : undefined}>{saving ? "Saving…" : "Record counteroffer"}</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Offered benefit type" htmlFor="counteroffer-tier">
          <select id="counteroffer-tier" className={control} value={tier} onChange={(e) => setTier(e.target.value)}>
            {FE_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Rating class" htmlFor="counteroffer-class" hint="Only if the carrier names one.">
          <input id="counteroffer-class" className={control} value={healthClass} onChange={(e) => setHealthClass(e.target.value)} placeholder="e.g. Standard" />
        </Field>
        <Field label="Face amount" htmlFor="counteroffer-face" required error={show("face")}>
          <input id="counteroffer-face" inputMode="decimal" className={control} value={faceText} onChange={(e) => setFaceText(e.target.value)} />
        </Field>
        <Field label="Monthly premium" htmlFor="counteroffer-monthly" required error={show("monthly")}>
          <input id="counteroffer-monthly" inputMode="decimal" className={control} value={monthlyText} onChange={(e) => setMonthlyText(e.target.value)} autoFocus />
        </Field>
        <Field label="Annual premium" htmlFor="counteroffer-annual" error={show("annual")} hint="Term offers state both.">
          <input id="counteroffer-annual" inputMode="decimal" className={control} value={annualText} onChange={(e) => setAnnualText(e.target.value)} />
        </Field>
        <Field label="Offer expires" htmlFor="counteroffer-expires" required error={show("expires")}>
          <input id="counteroffer-expires" type="date" className={control} value={expires} min={dateInput(today + DAY_MS)} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Effective date applied for" htmlFor="counteroffer-applied-effective" hint="Optional — from the application.">
          <input id="counteroffer-applied-effective" type="date" className={control} value={appliedEffective} onChange={(e) => setAppliedEffective(e.target.value)} />
        </Field>
        <Field label="Effective date offered" htmlFor="counteroffer-offered-effective" hint="Optional — from the carrier's notice.">
          <input id="counteroffer-offered-effective" type="date" className={control} value={offeredEffective} onChange={(e) => setOfferedEffective(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="counteroffer-reason" required error={show("reason")}>
        <input id="counteroffer-reason" className={control} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="From the carrier's notice" />
      </Field>
    </Overlay>
  );
}
