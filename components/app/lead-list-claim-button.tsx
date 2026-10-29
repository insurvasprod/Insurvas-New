"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/**
 * "Claim N for credit" — drafts ONE claim in the Vendor returns ledger from this list's creditable
 * import removals that are on no claim and still inside the vendor's window
 * (create_import_removal_claim, 20260925703200). The draft is submitted and resolved on Vendor
 * returns, like every other claim; this only starts it, and the page refreshes to show the rows as
 * claimed.
 */
export function LeadListClaimButton({ campaignId, rows, amount, blocked }: { campaignId: string; rows: number; amount: string; blocked: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/vendor-returns/import-removals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // A pending migration or a refusal is said beside the button, where the press happened.
        setError(typeof body?.error === "string" ? body.error : "Could not draft the claim.");
        return;
      }
      const drafted = typeof body?.rows === "number" ? body.rows : rows;
      const cents = typeof body?.amount_claimed_cents === "number" ? body.amount_claimed_cents : null;
      notify.done(
        `Draft claim for ${drafted.toLocaleString("en-US")} ${drafted === 1 ? "row" : "rows"}${cents == null ? "" : ` · $${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}`,
        { detail: "Submit it to the vendor on Vendor returns." },
      );
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was drafted.");
    } finally {
      setBusy(false);
    }
  }

  const disabledBy = blocked ?? (busy ? "Drafting the claim…" : null);
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={Boolean(disabledBy)}
        aria-describedby={blocked || error ? `claim-${campaignId}-why` : undefined}
        title={`Drafts one claim for ${amount} on Vendor returns`}
        onClick={() => void claim()}
      >
        {busy ? "Drafting…" : `Claim ${rows.toLocaleString("en-US")} for credit`}
      </Button>
      {(blocked || error) && (
        <span id={`claim-${campaignId}-why`} role={error ? "alert" : undefined} className="max-w-[280px] text-right text-xs leading-normal tracking-[-0.01em] text-muted-foreground">
          {error ?? blocked}
          {error && !blocked && <> <Link href="/app/vendor-returns" className="font-semibold text-foreground underline underline-offset-2">Vendor returns</Link></>}
        </span>
      )}
    </span>
  );
}
