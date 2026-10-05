import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { QuotesList } from "@/components/app/applications/quotes-list";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { ApplicationError } from "@/lib/applications/db";
import { FIXTURE_QUOTE_LIST } from "@/lib/applications/listFixtures";
import { listQuoteRows } from "@/lib/applications/lists";
import type { QuoteRow } from "@/lib/applications/listRules";

/** The design fixtures in the list's shape (?preview=sample, outside production). */
function sampleRows(): QuoteRow[] {
  return FIXTURE_QUOTE_LIST.map((q) => ({
    id: q.id, caseId: q.caseId, applicationId: null, clientName: q.clientName, insuredRole: q.insuredRole, state: q.state,
    carrierName: q.carrierName, productLabel: q.productLabel, productCode: "final_expense", tier: q.tier,
    faceAmountCents: q.faceAmountCents, monthlyPremiumCents: q.monthlyPremiumCents,
    outcome: q.status, per1000Warning: q.warnings.find((w) => w.code === "QUOTE_PER1000_BAND")?.message ?? null, createdAt: q.createdAt,
  }));
}

/** The page's data, or null while its migration is not applied. */
async function orPending<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return null;
    throw error;
  }
}

export default async function QuotingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("quoting");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Quoting" description="Compare carrier premiums side by side and keep every quote you give." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Quoting" detail="Owners and producers quote clients." />;
  const query = await searchParams;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") return <QuotesList rows={sampleRows()} sample />;
  const [rows, timeZone] = await Promise.all([orPending(listQuoteRows(guard.context.tenantId)), getWorkspaceTimezone(guard.context.tenantId).catch(() => null)]);
  if (!rows) return <SetupPending title="Quotes" />;
  return <QuotesList rows={rows} timeZone={timeZone ?? undefined} />;
}
