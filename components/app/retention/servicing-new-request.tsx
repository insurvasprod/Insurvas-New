"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cardSurface } from "@/components/ui/card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { REQUEST_LABELS, REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import { ServicingRequestForm } from "@/components/app/retention/servicing-request-form";
import { PolicyPicker, type PickedPolicy } from "@/components/app/retention/policy-picker";

/**
 * New servicing request, on its own page (SvA 2026-11-05; was two pop-ups): 1 find the policy by client
 * name, phone or policy number, 2 what changes, 3 the request form. Try again arrives with all three set.
 */
export function ServicingNewRequest({ initial }: { initial: { carrierId: string; policyNumber: string; type: RequestType | null } | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedPolicy | null>(initial ? { carrierId: initial.carrierId, policyNumber: initial.policyNumber, carrierName: null, clientName: null } : null);
  const [type, setType] = useState<RequestType | null>(initial?.type ?? null);

  return (
    <div className="flex flex-col gap-4">
      <PolicyPicker picked={picked} onPick={(p) => { setPicked(p); if (!p) setType(null); }} />

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
