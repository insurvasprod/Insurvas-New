"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Download, MoreHorizontal, Undo2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { notify } from "@/lib/notify";
import { historyCsv, type PolicyHistoryRow } from "@/lib/ingestion/policyPage";

/**
 * The policy page's small client parts (Book of business, round 2): Copy policy number, the History export,
 * Unlink and Undo. Each pop-up only confirms; every edit lives on a page or a tab. The record's tabs are
 * link ViewTabs on the title line (UI-CONSISTENCY §8a), drawn by the page itself.
 */

function copyPolicyNumber(policyNumber: string) {
  void navigator.clipboard?.writeText(policyNumber).then(
    () => notify.done(`Copied ${policyNumber}`),
    () => notify.warn("Couldn't copy", { detail: `Select the number and copy it: ${policyNumber}` }),
  );
}

export function CopyPolicyNumber({ policyNumber }: { policyNumber: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => copyPolicyNumber(policyNumber)}>
      <Copy aria-hidden="true" />Copy policy number
    </Button>
  );
}

export type MoreLink = { label: string; href: string };

/**
 * Round 3 (docs/la4/POLISH-ROUND3.md), round 5 (board 7): a detail page shows one button and this "More" menu —
 * the links that didn't fit (Change client, Add a note), Unlink (asks first), and Copy policy number.
 */
export function PolicyMoreMenu({ links, policyNumber, unlink }: { links: MoreLink[]; policyNumber: string; unlink?: UnlinkTarget | null }) {
  const run = useUnlink();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline"><MoreHorizontal aria-hidden="true" />More</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild><Link href={link.href}>{link.label}</Link></DropdownMenuItem>
        ))}
        {unlink && <DropdownMenuItem disabled={run.busy || Boolean(unlink.disabledReason)} onSelect={() => void run.unlink(unlink)}><Unlink aria-hidden="true" />Unlink</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => copyPolicyNumber(policyNumber)}><Copy aria-hidden="true" />Copy policy number</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
export type UnlinkTarget = { matchId: string; clientName: string | null; disabledReason: string | null };

/** The one Unlink flow, for the Client tab's button and the header's More menu. */
function useUnlink() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const unlink = async ({ matchId, clientName }: UnlinkTarget) => {
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
  return { busy, unlink };
}

export function UnlinkClient({ matchId, clientName, disabledReason }: UnlinkTarget) {
  const run = useUnlink();
  return (
    <Button type="button" variant="outline" disabled={run.busy || Boolean(disabledReason)} title={disabledReason ?? undefined} onClick={() => void run.unlink({ matchId, clientName, disabledReason })}>
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
