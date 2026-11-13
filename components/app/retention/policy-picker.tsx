"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { personName } from "@/lib/format/personName";
import type { PolicyMatch } from "@/lib/retention/servicingStore";

import { phoneText } from "./servicing-shared";

export type PickedPolicy = { carrierId: string; policyNumber: string; carrierName: string | null; clientName: string | null };

/**
 * "1 · The policy" on a Retention form page (a new servicing request, a new case): find it by the client's name,
 * phone or the policy number, then it shows as one line with Change policy. One component for both, so they read
 * and behave the same.
 */
export function PolicyPicker({ picked, onPick, title = "1 · The policy" }: { picked: PickedPolicy | null; onPick: (policy: PickedPolicy | null) => void; title?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PolicyMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      fetch(`/api/app/retention/servicing/policies?q=${encodeURIComponent(q)}`)
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as { policies?: PolicyMatch[]; error?: string };
          if (!r.ok) throw new Error(data.error ?? "The policies could not be searched.");
          if (live) setResults(data.policies ?? []);
        })
        .catch((e) => live && setError(e instanceof Error ? e.message : "The policies could not be searched."))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const shownResults = query.trim().length < 2 ? null : results;

  if (picked) {
    return (
      <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-labelledby="policy-picked">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="policy-picked" className="m-0 text-base font-semibold text-foreground">{title}</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => onPick(null)}>Change policy</Button>
        </div>
        <p className="m-0 text-sm text-foreground">
          <span className="font-semibold">{picked.clientName ? personName(picked.clientName) : `Policy ${picked.policyNumber}`}</span>
          <span className="text-muted-foreground">{picked.carrierName ? ` · ${picked.carrierName} ${picked.policyNumber}` : picked.clientName ? ` · ${picked.policyNumber}` : ""}</span>
        </p>
      </section>
    );
  }
  return (
    <TableCard
      title={title}
      toolbar={<DataToolbar><ToolbarSearch value={query} onChange={setQuery} placeholder="Client name, phone or policy number" className="sm:w-80" /></DataToolbar>}
    >
      {error ? (
        <p role="alert" className="m-0 px-5 py-4 text-sm text-[var(--error-ink)]">{error}</p>
      ) : !shownResults ? (
        searching ? <SectionLoading rows={3} columns={3} label="Searching" /> : <EmptyState title="Find the policy" hint="Search by the client's name, their phone or the policy number." />
      ) : shownResults.length === 0 ? (
        <EmptyState title="No policy matches" hint={`Nothing in your book matches "${query.trim()}". Try the last name, or the policy number as the carrier writes it.`} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr><th>Client</th><th>Policy</th><th>Status</th><th>Phone</th><th className="w-[120px] text-right"><span className="sr-only">Choose</span></th></tr>
          </thead>
          <tbody>
            {shownResults.map((p) => (
              <tr key={`${p.carrierId}|${p.policyNumber}`} className="m-row">
                <td className="whitespace-nowrap font-medium text-foreground">{p.clientName ? personName(p.clientName) : "No client linked"}</td>
                <td className="whitespace-nowrap">{p.carrierName} {p.policyNumber}</td>
                <td className="whitespace-nowrap">{p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1).replace(/_/g, " ") : <span className="text-muted-foreground">—</span>}</td>
                <td className="whitespace-nowrap tabular-nums">{p.phone ? phoneText(p.phone) : <span className="text-muted-foreground">—</span>}</td>
                <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => onPick({ carrierId: p.carrierId, policyNumber: p.policyNumber, carrierName: p.carrierName, clientName: p.clientName })}>Choose</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
