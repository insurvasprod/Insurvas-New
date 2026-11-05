"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { personName } from "@/lib/format/personName";
import { REQUEST_LABELS, REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import type { PolicyMatch } from "@/lib/retention/servicingStore";
import { ServicingRequestForm } from "@/components/app/retention/servicing-request-form";

import { phoneText } from "./servicing-shared";

type Picked = { carrierId: string; policyNumber: string; carrierName: string | null; clientName: string | null };

/**
 * New servicing request, on its own page (SvA 2026-11-05; was two pop-ups): 1 find the policy by client
 * name, phone or policy number, 2 what changes, 3 the request form. Try again arrives with all three set.
 */
export function ServicingNewRequest({ initial }: { initial: { carrierId: string; policyNumber: string; type: RequestType | null } | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PolicyMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(initial ? { carrierId: initial.carrierId, policyNumber: initial.policyNumber, carrierName: null, clientName: null } : null);
  const [type, setType] = useState<RequestType | null>(initial?.type ?? null);

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

  return (
    <div className="flex flex-col gap-4">
      {picked ? (
        <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-labelledby="svc-new-policy">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="svc-new-policy" className="m-0 text-base font-semibold text-foreground">1 · The policy</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => { setPicked(null); setType(null); }}>Change policy</Button>
          </div>
          <p className="m-0 text-sm text-foreground">
            <span className="font-semibold">{picked.clientName ? personName(picked.clientName) : `Policy ${picked.policyNumber}`}</span>
            <span className="text-muted-foreground">{picked.carrierName ? ` · ${picked.carrierName} ${picked.policyNumber}` : picked.clientName ? ` · ${picked.policyNumber}` : ""}</span>
          </p>
        </section>
      ) : (
        <TableCard
          title="1 · The policy"
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
                  <tr><th>Client</th><th>Policy</th><th>Phone</th><th className="w-[120px] text-right"><span className="sr-only">Choose</span></th></tr>
                </thead>
                <tbody>
                  {shownResults.map((p) => (
                    <tr key={`${p.carrierId}|${p.policyNumber}`} className="m-row">
                      <td className="font-semibold text-foreground">{p.clientName ? personName(p.clientName) : "No client linked"}</td>
                      <td><span className="block text-foreground">{p.carrierName} {p.policyNumber}</span>{p.status && <span className="block text-xs text-muted-foreground">{p.status.replace(/_/g, " ")}</span>}</td>
                      <td className="tabular-nums text-muted-foreground">{p.phone ? phoneText(p.phone) : "—"}</td>
                      <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setPicked({ carrierId: p.carrierId, policyNumber: p.policyNumber, carrierName: p.carrierName, clientName: p.clientName })}>Choose</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
          )}
        </TableCard>
      )}

      {picked && (
        <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-labelledby="svc-new-type">
          <h2 id="svc-new-type" className="m-0 text-base font-semibold text-foreground">2 · What changes</h2>
          <div role="radiogroup" aria-label="What changes" className="flex flex-wrap gap-2">
            {REQUEST_TYPES.map((t) => <ToggleChip key={t} role="radio" selected={type === t} onClick={() => setType(t)}>{REQUEST_LABELS[t]}</ToggleChip>)}
          </div>
        </section>
      )}

      {picked && type && (
        <ServicingRequestForm
          key={`${picked.carrierId}|${picked.policyNumber}|${type}`}
          carrierId={picked.carrierId}
          policyNumber={picked.policyNumber}
          type={type}
          origin="client_request"
          fromQueue={false}
          onCancel={() => router.push("/app/servicing")}
          onDone={(id) => router.push(id ? `/app/servicing/${id}` : "/app/servicing")}
        />
      )}
    </div>
  );
}
