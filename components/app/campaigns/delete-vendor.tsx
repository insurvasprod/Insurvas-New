"use client";

import { useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, plural } from "@/components/app/vendor-roster";

/**
 * Deleting a vendor (owner 2026-10-29), shared by the scorecard, the Compare vendors row and the edit
 * form. A vendor with no campaigns: one warning. A vendor with campaigns: two — what it holds, then
 * the campaigns that go with it — and the server deletes them first, only when every one is empty
 * (DELETE /api/app/vendors with `withCampaigns`). When one is not, the second warning lists which
 * campaigns hold it and its Delete is disabled.
 */
export type DeletableVendor = {
  id: string; name: string; campaign_count: number; active_campaign_count?: number;
  total_spend_cents?: number; records_purchased?: number;
};
type Blocked = { id: string; name: string; reason: string };
type Check = { campaigns: Array<{ id: string; name: string }>; blocked: Blocked[]; vendorBlocker: string | null };
type Refusal = { title: string; lines: string[] };

/** "It has invoices — set it to Inactive instead." said of the vendor by name. */
const named = (name: string, reason: string) => (reason.startsWith("It ") ? `${name} ${reason.slice(3)}` : `${name}: ${reason}`);

/** What the vendor holds, for the first warning. */
function holds(vendor: DeletableVendor) {
  if (vendor.campaign_count === 0) return `The vendor ${vendor.name} is deleted for good, with its saved column maps. It has no campaigns.`;
  const parts = [
    `${plural(vendor.campaign_count, "campaign")}${vendor.active_campaign_count ? ` (${vendor.active_campaign_count} active)` : ""}`,
    vendor.total_spend_cents ? `${money(vendor.total_spend_cents)} of recorded spend` : null,
    vendor.records_purchased ? plural(vendor.records_purchased, "record") : null,
  ].filter(Boolean);
  return `${vendor.name} holds ${parts.join(", ")}. The vendor and its campaigns are deleted for good.`;
}

/** `onDeleted(id)` after the vendor is gone; `onDeleted(null)` when only some of its campaigns went. */
export function useVendorDelete(onDeleted: (vendorId: string | null) => Promise<unknown> | void) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(vendor: DeletableVendor, withCampaigns: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/app/vendors", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withCampaigns ? { id: vendor.id, withCampaigns: true } : { id: vendor.id }),
      }).catch(() => null);
      const body = response ? await response.json().catch(() => null) : null;
      if (!response?.ok) {
        const blocked: Blocked[] = Array.isArray(body?.blocked) ? body.blocked : [];
        if (blocked.length > 0) setRefusal({ title: `${vendor.name} can't be deleted`, lines: blocked.map((item) => item.reason) });
        else notify.block(body?.error ?? `Could not delete ${vendor.name}`);
        // Some campaigns may already be gone when a later one stopped it: the page reloads either way.
        if (Array.isArray(body?.deletedCampaigns) && body.deletedCampaigns.length > 0) await onDeleted(null);
        return;
      }
      const gone = Array.isArray(body?.deletedCampaigns) ? body.deletedCampaigns.length : 0;
      notify.done(gone > 0 ? `${vendor.name} and its ${plural(gone, "campaign")} deleted` : `${vendor.name} deleted`);
      await onDeleted(vendor.id);
    } finally { setBusy(false); }
  }

  async function requestDelete(vendor: DeletableVendor) {
    if (busy) return;
    if (vendor.campaign_count === 0) {
      const ok = await confirmAction({ title: "Are you sure you want to delete this?", description: holds(vendor), confirmLabel: "Delete" });
      if (ok) await send(vendor, false);
      return;
    }
    // First warning: the vendor and what it holds.
    if (!(await confirmAction({ title: `Are you sure you want to delete ${vendor.name}?`, description: holds(vendor), confirmLabel: "Delete" }))) return;

    setBusy(true);
    let check: Check | null = null;
    try {
      const response = await fetch(`/api/app/vendors?deleteCheck=${encodeURIComponent(vendor.id)}`, { cache: "no-store" }).catch(() => null);
      const body = response ? await response.json().catch(() => null) : null;
      if (!response?.ok) { notify.block(body?.error ?? `Could not check ${vendor.name}`); return; }
      check = body as Check;
    } finally { setBusy(false); }
    if (!check) return;

    const count = check.campaigns.length;
    const title = `Deleting ${vendor.name} also deletes its ${plural(count, "campaign")}`;
    if (check.blocked.length > 0 || check.vendorBlocker) {
      setRefusal({ title, lines: [...check.blocked.map((item) => item.reason), ...(check.vendorBlocker ? [named(vendor.name, check.vendorBlocker)] : [])] });
      return;
    }
    // Second warning: the campaigns that go with it, by name.
    const ok = await confirmAction({
      title,
      description: `${check.campaigns.map((campaign) => campaign.name).join(", ")} — this can't be undone.`,
      confirmLabel: "Delete",
    });
    if (ok) await send(vendor, true);
  }

  const dialog: ReactNode = <Dialog open={refusal !== null} onOpenChange={(open) => { if (!open) setRefusal(null); }}>
    <DialogContent size="sm" role="alertdialog" showCloseButton={false}>
      <DialogHeader className="gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--error-surface)] text-[var(--error-ink)]" aria-hidden="true"><TriangleAlert className="size-5" /></span>
        <DialogTitle>{refusal?.title}</DialogTitle>
        <DialogDescription className="text-[var(--body)]">Nothing was deleted. These hold it:</DialogDescription>
      </DialogHeader>
      <ul className="m-0 flex list-disc flex-col gap-1 rounded-md border border-[var(--border)] py-2.5 pr-3 pl-7 text-sm text-[var(--body)]">
        {refusal?.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setRefusal(null)}>Cancel</Button>
        <Button type="button" variant="destructive" disabled title="Clear what holds it first">Delete</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return { requestDelete, busy, dialog };
}
