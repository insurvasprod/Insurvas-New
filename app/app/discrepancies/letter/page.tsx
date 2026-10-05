import type { Metadata } from "next";
import { headers } from "next/headers";

import { guardPage } from "@/lib/entitlements/guardPage";
import { audit } from "@/lib/audit/log";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PrintButton } from "@/components/app/applications/quotes/print-button";
import { DISCREPANCY_KIND_LABELS } from "@/lib/discrepancies/compute";
import { listDiscrepancies } from "@/lib/discrepancies/service";
import { isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

export const metadata: Metadata = { title: "Commission dispute" };

/**
 * /app/discrepancies/letter?carrier=…&ids=… · LA-4.5: a dispute letter to one carrier's commissions
 * department, listing the selected discrepancies with the arithmetic for each and the total.
 *
 * OUTSIDE the (shell) group, like the client quote sheet, so it prints as a letter with no sidebar.
 * Reading only — it changes nothing; marking the items disputed is done on the Discrepancies page.
 * Owner and bookkeeper, as that page. Generating one is audited.
 */
export default async function DisputeLetterPage({ searchParams }: { searchParams: Promise<{ carrier?: string; ids?: string }> }) {
  const guard = await guardPage("discrepancy_report");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Discrepancies" description="What each carrier paid against what your contract says it owes, with a dispute letter for each one." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Discrepancies" detail="Dispute letters are prepared by the account owner or a bookkeeper." />;

  const tenantId = guard.context.tenantId;
  const { carrier = "", ids = "" } = await searchParams;
  const wanted = new Set(ids.split(",").map((id) => id.trim()).filter(isRecordId));
  const list = await listDiscrepancies(tenantId);
  // Only this workspace's findings, for this one carrier, that are not cleared.
  const items = list.items.filter((item) => wanted.has(item.id) && item.carrierId === carrier && item.status !== "cleared");

  if (!isRecordId(carrier) || items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center text-sm text-muted-foreground">
        Choose one carrier&rsquo;s discrepancies on the Discrepancies page, then open the letter again.
      </main>
    );
  }

  // agency_profiles is newer than the generated types; read through a plain query shape.
  type Row<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
  type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: unknown): { maybeSingle(): Row<Record<string, string | null>> } } } };
  const db = getSupabaseServiceClient();
  const loose = db as unknown as Loose;
  const [profile, tenant, user, contract] = await Promise.all([
    loose.from("agency_profiles").select("legal_name, dba, npn, principal_address").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    db.from("users").select("name, email, phone").eq("id", guard.context.userId).maybeSingle(),
    db.from("tenant_carriers").select("writing_number").eq("tenant_id", tenantId).eq("carrier_id", carrier).eq("is_active", true).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const agencyName = profile.data?.dba?.trim() || profile.data?.legal_name?.trim() || tenant.data?.name?.trim() || "Our agency";
  const carrierName = items[0].carrierName;
  const total = items.reduce((sum, item) => sum + item.owedCents, 0);
  const today = new Date().toISOString().slice(0, 10);

  // A page has no Request; the audit row's IP and user agent come from the incoming headers.
  const incoming = await headers();
  await audit({
    actorType: "tenant",
    actorId: guard.context.userId,
    action: "tenant.dispute_letter_generated",
    targetType: "carrier",
    targetId: carrier,
    metadata: { tenantId, carrierName, discrepancyIds: items.map((item) => item.id), totalCents: total },
    request: new Request("https://app.insurvas.com/app/discrepancies/letter", { headers: incoming }),
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-card px-8 py-10 text-[14px] leading-[1.6] text-foreground print:max-w-none print:px-0 print:py-0">
      <div className="flex justify-end print:hidden"><PrintButton /></div>

      <header className="flex flex-col gap-1">
        <p className="m-0 font-semibold">{agencyName}</p>
        {profile.data?.principal_address && <p className="m-0 whitespace-pre-line text-muted-foreground">{profile.data.principal_address}</p>}
        {profile.data?.npn && <p className="m-0 text-muted-foreground">NPN {profile.data.npn}</p>}
        <p className="m-0 mt-4 text-muted-foreground">{statementDay(today)}</p>
        <p className="m-0 mt-4">{carrierName}<br />Commissions Department</p>
      </header>

      <section className="flex flex-col gap-3">
        <p className="m-0 font-semibold">Re: Commission discrepancies{contract.data?.writing_number ? ` · writing number ${contract.data.writing_number}` : ""}</p>
        <p className="m-0">To the Commissions Department,</p>
        <p className="m-0">
          Comparing your commission statements with my contract level and your commission schedule, the {items.length === 1 ? "payment below differs" : `${items.length} payments below differ`} from what is owed. The total is <strong>{statementMoney(total)}</strong>. Please review {items.length === 1 ? "it" : "them"} and pay the difference, or tell me where my figures are wrong.
        </p>
      </section>

      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-3">Policy</th>
            <th className="py-2 pr-3">Insured</th>
            <th className="py-2 pr-3">Problem</th>
            <th className="py-2 pr-3">Period</th>
            <th className="py-2 pr-3 text-right">Expected</th>
            <th className="py-2 pr-3 text-right">Paid</th>
            <th className="py-2 text-right">Owed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border align-top">
              <td className="py-2 pr-3 font-semibold tabular-nums">{item.policyNumber}</td>
              <td className="py-2 pr-3">{item.insuredName}</td>
              <td className="py-2 pr-3">{DISCREPANCY_KIND_LABELS[item.kind].label}<span className="block text-xs text-muted-foreground">{item.detail?.explanation}</span></td>
              <td className="py-2 pr-3 tabular-nums">{item.periodStart && item.periodEnd ? statementPeriod(item.periodStart, item.periodEnd) : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{statementMoney(item.detail?.expectedCents ?? 0)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{statementMoney(item.detail?.receivedCents ?? 0)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{statementMoney(item.owedCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="py-2 pr-3 text-right font-semibold">Total owed</td>
            <td className="py-2 text-right font-semibold tabular-nums">{statementMoney(total)}</td>
          </tr>
        </tfoot>
      </table>

      <section className="flex flex-col gap-1">
        <p className="m-0">Thank you,</p>
        <p className="m-0 mt-6 font-semibold">{user.data?.name ?? agencyName}</p>
        <p className="m-0 text-muted-foreground">{[agencyName, user.data?.phone, user.data?.email].filter(Boolean).join(" · ")}</p>
      </section>
    </main>
  );
}
