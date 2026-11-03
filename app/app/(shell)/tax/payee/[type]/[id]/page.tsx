import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { maskTaxId } from "@/lib/accounting/taxCore";
import { contractors, latestW9, TaxError, taxSettings } from "@/lib/accounting/taxStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { ProfileForm, RevealTaxId, TaxNotice, TaxState, W9Actions } from "@/components/app/accounting/tax-board";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Accounting › Tax summaries › a contractor (LA-7.8; foundation pass 2026-11-03, was an 11-field pop-up): the
 * name on the form with its 1099 state, one line of facts, Reveal tax ID (audited, only for the roles the
 * agency allows) and the details form. Owner and bookkeeper only. Opening it writes nothing; Reveal writes
 * its audit row before the number is shown.
 */
const TYPES = ["partner", "producer", "vendor"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PayeePage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ year?: string }> }) {
  const guard = await guardPage("tax_summaries");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Tax summaries" description="What the accountant asks for, from your records." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Tax summaries" detail="Only owners and bookkeepers can see the agency's tax figures." />;
  const { type, id } = await params;
  if (!TYPES.some((t) => t === type) || !UUID.test(id)) notFound();
  const q = await searchParams;
  const year = /^\d{4}$/.test(q.year ?? "") ? Number(q.year) : new Date().getUTCFullYear();
  const tenantId = guard.context.tenantId;
  let loaded: { people: Awaited<ReturnType<typeof contractors>>; canReveal: boolean } | null = null;
  let problem: string | null = null;
  try {
    const [settings, people] = await Promise.all([taxSettings(tenantId), contractors(tenantId, year)]);
    loaded = { people, canReveal: settings.viewerRoles.includes(guard.role) };
  } catch (error) {
    if (!(error instanceof TaxError)) throw error;
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="tax" title="Contractor"><TableCard footer={<TaxNotice />}><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  // Under the threshold this year is still a contractor whose details can be kept.
  const row = [...loaded.people.rows, ...loaded.people.under].find((r) => r.payeeType === type && r.payeeId === id);
  if (!row) notFound();
  const readOnly = guard.entitlement.access === "read_only";
  // The W-9 on file (LA-7.8 upload): its file, once the details are saved (the file hangs off the profile).
  const w9 = row.profileId ? await latestW9(tenantId, row.profileId) : null;
  const facts = [row.displayName, row.payeeType[0].toUpperCase() + row.payeeType.slice(1), `Paid ${formatCentsAsCurrency(row.paidCents)} in ${year}`, maskTaxId(row.profile?.taxIdType ?? "none", row.profile?.taxIdLast4 ?? null), w9 ? `W-9 file from ${w9.uploadedAt || "earlier"}` : row.profileId ? "no W-9 file" : "save the details to attach a W-9"].join(" · ");
  return (
    <AccountingPage
      step="tax"
      title={row.nameOnForm}
      chip={<TaxState row={row} />}
      facts={facts}
      actions={<>
        {row.profileId ? <W9Actions profileId={row.profileId} hasFile={w9 !== null} readOnly={readOnly} /> : null}
        {row.profileId && row.profile?.taxIdLast4 && loaded.canReveal ? <RevealTaxId profileId={row.profileId} /> : null}
      </>}
    >
      {/* Keyed on W-9 on file, so attaching a W-9 (which ticks it) redraws the form with the box ticked. */}
      <ProfileForm key={String(row.profile?.w9OnFile ?? false)} row={row} year={year} readOnly={readOnly} />
    </AccountingPage>
  );
}
