"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";

type Choice = { id: string; name: string; vendor_id?: string | null };

/**
 * LA-4.11 · the agency's own fields on a policy: notes, and the lead source when the sale did not
 * come through us. Carrier fields are not here; the carrier's file is the truth for those.
 */
export function PolicyAnnotationForm({ carrierId, policyNumber, notes, vendorId, campaignId, vendors, campaigns, leadFromSale, disabledReason }: {
  carrierId: string; policyNumber: string; notes: string; vendorId: string | null; campaignId: string | null;
  vendors: Choice[]; campaigns: Choice[]; leadFromSale: boolean; disabledReason: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(notes);
  const [vendor, setVendor] = useState(vendorId ?? "");
  const [campaign, setCampaign] = useState(campaignId ?? "");
  const [busy, setBusy] = useState(false);
  const changed = text !== notes || vendor !== (vendorId ?? "") || campaign !== (campaignId ?? "");
  const campaignChoices = campaigns.filter((item) => !vendor || !item.vendor_id || item.vendor_id === vendor);

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/policy-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_annotation", carrier_id: carrierId, policy_number: policyNumber, notes: text, lead_vendor_id: vendor || null, lead_campaign_id: campaign || null }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done("Saved.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={Boolean(disabledReason) || busy} className="grid gap-3 text-sm" title={disabledReason ?? undefined}>
      <div className="grid gap-1.5">
        <Label htmlFor="policy-notes">Notes</Label>
        <textarea id="policy-notes" rows={4} maxLength={4000} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Anything the team should know about this policy" value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="policy-lead-vendor">Lead vendor</Label>
          <select id="policy-lead-vendor" className={`${toolbarControl} w-full`} value={vendor} onChange={(event) => { setVendor(event.target.value); setCampaign(""); }}>
            <option value="">{leadFromSale ? "As the sale recorded" : "Not set"}</option>
            {vendors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="policy-lead-campaign">Campaign</Label>
          <select id="policy-lead-campaign" className={`${toolbarControl} w-full`} value={campaign} onChange={(event) => setCampaign(event.target.value)}>
            <option value="">{leadFromSale ? "As the sale recorded" : "Not set"}</option>
            {campaignChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!changed} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
        {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      </div>
    </fieldset>
  );
}
