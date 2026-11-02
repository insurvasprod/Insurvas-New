"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Undo2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { UnderlineTabs, type ViewTab } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";
import { historyCsv, type PolicyHistoryRow, type PolicyTab } from "@/lib/ingestion/policyPage";

/**
 * The policy page's small client parts (Book of business, round 2): the record's tabs, Copy policy number,
 * the History export, Unlink and Undo. Each pop-up only confirms; every edit lives on a page or a tab.
 */

/** The record's tabs as `?tab=` links: the server draws the chosen tab, so a tab is shareable and Back works. */
export function PolicyTabs({ tabs, value, hrefs }: { tabs: ReadonlyArray<ViewTab<PolicyTab>>; value: PolicyTab; hrefs: Record<string, string> }) {
  const router = useRouter();
  return <UnderlineTabs label="This policy" tabs={tabs} value={value} onChange={(key) => router.push(hrefs[key], { scroll: false })} />;
}

export function CopyPolicyNumber({ policyNumber }: { policyNumber: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigator.clipboard?.writeText(policyNumber).then(
          () => notify.done(`Copied ${policyNumber}`),
          () => notify.warn("Couldn't copy", { detail: `Select the number and copy it: ${policyNumber}` }),
        );
      }}
    >
      <Copy aria-hidden="true" />Copy policy number
    </Button>
  );
}

/** Export history: the rows on screen (the field filter applied), as a CSV the browser saves. */
export function ExportHistory({ rows, policyNumber }: { rows: PolicyHistoryRow[]; policyNumber: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={rows.length === 0}
      onClick={() => {
        const url = URL.createObjectURL(new Blob([historyCsv(rows)], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `policy-${policyNumber.replace(/[^A-Za-z0-9-]/g, "_")}-history.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download aria-hidden="true" />Export history
    </Button>
  );
}

/**
 * Unlink, after asking: Policy matching's own "reopen" (POST /api/app/policy-matching). The policy goes back
 * to Needs you with a fresh shortlist; its link stands until a person decides there, so no money moves now.
 */
export function UnlinkClient({ matchId, clientName, disabledReason }: { matchId: string; clientName: string | null; disabledReason: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const unlink = async () => {
    const ok = await confirmAction({
      title: "Unlink this client?",
      description: `The policy goes back to Needs you to choose its client again${clientName ? `, with ${clientName} among the choices` : ""}. Until someone decides, it stays linked as it is now.`,
      confirmLabel: "Unlink",
      cancelLabel: "Keep the link",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch("/api/app/policy-matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen", match_id: matchId }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { notify.block("Couldn't unlink", { detail: body.error ?? "Try again." }); return; }
      notify.done("Back in Needs you to choose the client");
      router.refresh();
    } catch {
      notify.fail("Couldn't unlink", { detail: "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" disabled={busy || Boolean(disabledReason)} title={disabledReason ?? undefined} onClick={() => void unlink()}>
      <Unlink aria-hidden="true" />Unlink
    </Button>
  );
}

/**
 * Undo a card move, after asking: the existing put-back (POST /api/app/leads/[id]/reconcile-stage,
 * reconcileLeadStage), which puts the card where the application says and writes the history row.
 */
export function UndoMove({ leadId, from, to, disabledReason }: { leadId: string; from: string; to: string; disabledReason: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    const ok = await confirmAction({
      title: "Undo this move?",
      description: `The card goes back from ${from} to ${to}, where its application puts it. A history row records the move back.`,
      confirmLabel: "Undo the move",
      cancelLabel: "Keep it",
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/app/leads/${encodeURIComponent(leadId)}/reconcile-stage`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; toStageName?: string | null };
      if (!response.ok) { notify.block("Couldn't undo the move", { detail: body.error ?? "Try again." }); return; }
      notify.done(`Move undone · the card is back in ${body.toStageName ?? to}`);
      router.refresh();
    } catch {
      notify.fail("Couldn't undo the move", { detail: "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy || Boolean(disabledReason)} title={disabledReason ?? undefined} onClick={() => void undo()}>
      <Undo2 aria-hidden="true" />Undo
    </Button>
  );
}
