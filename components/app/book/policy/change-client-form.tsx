"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field, textareaControl } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { WHY_MAX } from "@/lib/ingestion/policyPage";
import { notify } from "@/lib/notify";

export type ChangeClientMatch = {
  contactId: string;
  name: string;
  dob: string | null;
  phone: string | null;
  provisional: boolean;
  sale: { date: string | null; agentName: string | null; carrierMatches: boolean } | null;
  matched: number;
  of: number;
  facts: string[];
  linkedNow: boolean;
};

/**
 * Change client (canvas board BobE1b; its own page, was a side sheet): the matches side by side with their
 * count against the carrier's row, what changing it does in plain words, the why kept with the link, then
 * Cancel or Link to <name>. The write is POST /api/app/policies/client-link (record_policy_match).
 */
export function ChangeClientForm({ matches, query, carrierId, policyNumber, backHref, policyFacts, canEdit, blockedReason }: {
  matches: ChangeClientMatch[];
  query: string;
  carrierId: string;
  policyNumber: string;
  backHref: string;
  policyFacts: { currentName: string | null; historyRows: number | null; advanceCents: number | null; hasCard: boolean };
  canEdit: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = matches.find((match) => match.contactId === chosen) ?? null;

  const link = async () => {
    if (!pick) return;
    if (!why.trim()) { setError("Say why, so the link history explains the change."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/policies/client-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: carrierId, policy_number: policyNumber, contact_id: pick.contactId, reason: why.trim() }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) { setError(body.error ?? "That could not be saved. Try again."); return; }
      notify.done(`${policyNumber} is now linked to ${pick.name}`);
      router.push(backHref);
      router.refresh();
    } catch {
      notify.fail("Couldn't link the client", { detail: "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const what = [
    policyNumber,
    policyFacts.historyRows ? `its ${policyFacts.historyRows.toLocaleString("en-US")} history ${policyFacts.historyRows === 1 ? "row" : "rows"}` : null,
    policyFacts.advanceCents ? `its ${money(policyFacts.advanceCents)} advance` : null,
  ].filter(Boolean) as string[];
  const whatText = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0];

  return (
    <>
      <TableCard title={query ? `Matches for “${query}”` : "Matches"} description="Set against the carrier's row: first name, last name, date of birth, phone, and a sale with this carrier.">
        {matches.length === 0 ? (
          <EmptyState title={query ? "No client matches that" : "Search for the client"} hint={query ? "Try the last name alone, the phone number, the date of birth (1958-03-03) or another policy number." : "Search by name, phone, date of birth or policy number."} />
        ) : (
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Client</th><th>Born · phone</th><th className="w-[130px]">Match</th><th className="w-[80px]"><span className="sr-only">Choose</span></th></tr></thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.contactId} aria-selected={chosen === match.contactId}>
                  <td>
                    <label htmlFor={`client-${match.contactId}`} className="block cursor-pointer">
                      <span className="font-medium text-foreground">{match.name}{match.provisional ? " (provisional)" : ""}</span>
                      <span className="block text-xs text-muted-foreground">{match.linkedNow ? "linked now" : match.sale ? `sale ${fileDay(match.sale.date)}${match.sale.agentName ? ` · ${match.sale.agentName}` : ""}${match.sale.carrierMatches ? "" : " · another carrier"}` : match.provisional ? "made from a carrier's file" : "no sale on record"}</span>
                    </label>
                  </td>
                  <td className="tabular-nums text-muted-foreground">{[match.dob ? fileDay(match.dob) : null, match.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td title={match.facts.length ? `Same ${match.facts.join(", ")}` : "Nothing in common with the carrier's row"}><StatusChip tone={match.matched >= 4 ? "good" : "neutral"}>{`${match.matched} of ${match.of}`}</StatusChip></td>
                  <td className="text-right">
                    <input id={`client-${match.contactId}`} type="radio" name="client" value={match.contactId} checked={chosen === match.contactId} disabled={match.linkedNow || !canEdit} onChange={() => setChosen(match.contactId)} className="size-4 accent-[var(--primary)]" aria-label={`Choose ${match.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard title="What changing it does">
        <div className="flex flex-col gap-4 px-4 pb-4">
          <p className="m-0 text-sm text-[var(--body)]">
            {pick ? (
              <>
                {whatText} move to <strong className="font-semibold text-foreground">{pick.name}</strong>.{" "}
                {pick.sale?.carrierMatches ? `${pick.name}'s card follows the application once.` : `${pick.name} has no sale with this carrier, so no card moves.`}{" "}
                {policyFacts.currentName && policyFacts.hasCard ? `${policyFacts.currentName}'s card stays where it is; move it by hand from the lead if this policy put it there.` : ""}{" "}
                The old link stays in the link history, with your reason.
              </>
            ) : (
              <>Choose a client above. The policy, its history and its money move to them; the old link stays in the link history with your reason.</>
            )}
          </p>
          <Field label="Why (kept with the link)" htmlFor="change-client-why" error={error}>
            <textarea id="change-client-why" className={textareaControl} maxLength={WHY_MAX} value={why} onChange={(event) => setWhy(event.target.value)} placeholder="Wrong person: same name and phone, different birth date" disabled={!canEdit} />
          </Field>
        </div>
      </TableCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!canEdit && blockedReason && <span className="mr-auto text-sm text-muted-foreground">{blockedReason}</span>}
        <Button asChild variant="outline"><Link href={backHref}>Cancel</Link></Button>
        <Button type="button" disabled={!canEdit || !pick || busy} onClick={() => void link()}>{pick ? `Link to ${pick.name}` : "Link"}</Button>
      </div>
    </>
  );
}
