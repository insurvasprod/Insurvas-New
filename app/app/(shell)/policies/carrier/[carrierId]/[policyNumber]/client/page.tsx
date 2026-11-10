import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ChangeClientForm } from "@/components/app/book/policy/change-client-form";
import { PolicyLead } from "@/components/app/book/policy/policy-head";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Input } from "@/components/ui/input";
import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature } from "@/lib/entitlements/types";
import { holdsAnyRole } from "@/lib/tenantAuth/teamAccess";
import { statusLabel } from "@/lib/ingestion/policyBook";
import { loadPolicy, PolicyBookError } from "@/lib/ingestion/policyBookStore";
import { carrierPerson, searchClients } from "@/lib/ingestion/policyClientStore";
import { carrierPolicyHref, statusTone } from "@/lib/ingestion/policyPage";
import { policyKeys, policyTabCounts } from "@/lib/ingestion/policyPageStore";
import { isRecordUuid } from "@/lib/ingestion/path";

/**
 * Book of business › Policies › a policy › Change client (round 2, canvas board BobE1b): its own page, was a
 * side sheet. Search clients by name, phone, date of birth or policy number (`?q=`, the contact directory's
 * search and two of its own); the matches side by side with how many facts they share with the carrier's
 * row; what changing it does; the why; Cancel or Link to <name>.
 *
 * Read by owner, producer and bookkeeper, as the policy page (a producer only for a policy credited to them,
 * searching only the clients their scope shows). Linking is Policy matching's write, owner and bookkeeper.
 */
export default async function ChangeClientPage({ params, searchParams }: { params: Promise<{ carrierId: string; policyNumber: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." />;
  const [{ carrierId, policyNumber: raw }, sp] = await Promise.all([params, searchParams]);
  const policyNumber = decodeURIComponent(raw);
  if (!isRecordUuid(carrierId) || !policyNumber || policyNumber.length > 100) notFound();
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").trim().slice(0, 120);

  const scope = await scopeFor(guard.context);
  const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
  let view: Awaited<ReturnType<typeof loadPolicy>>;
  try {
    view = await loadPolicy(viewer, carrierId, policyNumber);
  } catch (error) {
    if (!(error instanceof PolicyBookError) || error.status !== 503) throw error;
    return <DataInPage step="policies" title={`Change the client for ${policyNumber}`}><EmptyState title="The policy list isn't available yet" hint={error.message} /></DataInPage>;
  }
  if (!view) {
    return <DataInPage step="policies" title={`Change the client for ${policyNumber}`}><EmptyState title="This policy is not in your book" hint="Only a policy from a carrier file can be linked to a client here." /></DataInPage>;
  }
  const tenantId = guard.context.tenantId;
  const { policy, client } = view;
  const backHref = carrierPolicyHref(carrierId, policy.policyNumber, "client");
  const readOnly = guard.entitlement.access === "read_only";
  const allowed = holdsAnyRole(guard.roles, ["owner", "bookkeeper"]) && hasFeature(guard.entitlement, "statement_ingestion");
  const canEdit = allowed && !readOnly;
  const blockedReason = readOnly ? "The account is read-only." : allowed ? null : "The owner or a bookkeeper changes a policy's client.";

  const [keys, person] = await Promise.all([policyKeys(viewer, carrierId, policy.policyNumber), carrierPerson(tenantId, carrierId, policy.policyNumber)]);
  const [counts, matches] = await Promise.all([
    policyTabCounts(tenantId, carrierId, policy.policyNumber, keys?.leadId ?? null),
    query ? searchClients({ tenantId, carrierId, policyNumber: policy.policyNumber, query, scope, currentContactId: keys?.contactId ?? null, carrier: person }) : Promise.resolve([]),
  ]);
  const carrierName = [person?.firstName, person?.lastName].filter(Boolean).join(" ");

  return (
    <DataInPage
      step="policies"
      title={`Change the client for ${policy.policyNumber}`}
      // The policy's status and facts are the title's chip and facts line (the title line holds no tabs, §8b).
      facts={<PolicyLead status={statusLabel(policy.status)} tone={statusTone(policy.status)} facts={[client?.name ? `Linked now to ${client.name}` : "No client linked", policy.carrierName, carrierName ? `the carrier's file says ${carrierName}` : null]} />}
      actions={<Button asChild variant="outline"><Link href={backHref}>Cancel</Link></Button>}
    >
      <form method="get" role="search" className="flex max-w-[640px] items-center gap-2">
        <label htmlFor="client-search" className="sr-only">Search clients</label>
        <Input id="client-search" name="q" type="search" defaultValue={query} placeholder="Search clients by name, phone, date of birth or policy number" autoComplete="off" />
        <Button type="submit" variant="outline"><Search aria-hidden="true" />Search</Button>
      </form>
      <ChangeClientForm
        matches={matches}
        query={query}
        carrierId={carrierId}
        policyNumber={policy.policyNumber}
        backHref={backHref}
        policyFacts={{ currentName: client?.name ?? null, historyRows: counts.history, advanceCents: view.ledger.totals?.advancedCents ?? null, hasCard: Boolean(keys?.leadId) }}
        canEdit={canEdit}
        blockedReason={blockedReason}
      />
    </DataInPage>
  );
}
