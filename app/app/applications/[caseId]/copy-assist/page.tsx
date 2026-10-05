import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { CopyAssistPanel } from "@/components/app/applications/copy-assist/copy-assist-panel";
import { SampleDataNotice } from "@/components/app/applications/parts";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { FIXTURE_ATTEMPT, FIXTURE_CASE } from "@/lib/applications/fixtures";
import { ApplicationError } from "@/lib/applications/db";
import { isUuid } from "@/lib/applications/http";
import { getCaseView } from "@/lib/applications/service";
import type { CaseView } from "@/lib/applications/types";

export const metadata: Metadata = { title: "Copy-assist · Insurvas" };

/**
 * /app/applications/[caseId]/copy-assist?attempt=N[&role=spouse] — copy-assist on its own (LA-3.14,
 * board l3-copy-assist), opened by "Pop out" in a narrow window beside the carrier's site. Outside
 * the shell on purpose: no sidebar, no top bar, nothing between the agent and the values. It reads
 * the same case the workspace does, and its ticks are the inline panel's (tenant_copy_assist_ticks).
 * `?preview=sample` renders the fixtures outside production.
 */
export default async function CopyAssistPopoutPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const guard = await guardPage("applications");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Applications" description="Take a sale from the health interview to the carrier's policy number in one place." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Applications" detail="Owners and producers work applications." />;
  const [{ caseId }, query] = await Promise.all([params, searchParams]);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const sample = first(query.preview) === "sample" && process.env.NODE_ENV !== "production";
  const role = first(query.role) === "spouse" ? "spouse" : "primary";

  let caseView: CaseView;
  if (sample) {
    caseView = FIXTURE_CASE;
  } else {
    if (!isUuid(caseId)) notFound();
    try {
      caseView = await getCaseView(guard.context.tenantId, caseId);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "CASE_NOT_FOUND") notFound();
      if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return <SetupPending title="Copy-assist" />;
      throw error;
    }
  }
  const forRole = caseView.attempts.filter((a) => a.insuredRole === role);
  const attemptNo = Number(first(query.attempt));
  const attempt = forRole.find((a) => a.attemptNo === attemptNo) ?? [...forRole].sort((a, b) => b.attemptNo - a.attemptNo)[0] ?? (sample ? FIXTURE_ATTEMPT : null);
  if (!attempt) notFound();
  const insured = [attempt.values["insured.first_name"]?.value, attempt.values["insured.last_name"]?.value].filter((v) => typeof v === "string" && v).join(" ");
  const subtitle = [insured || (role === "spouse" ? `${caseView.clientName}'s spouse` : caseView.clientName), attempt.carrierName].filter(Boolean).join(" · ");

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-6 sm:px-8">
      <div className="m-stagger mx-auto flex max-w-[460px] flex-col gap-6">
        {sample && <SampleDataNotice />}
        <CopyAssistPanel attempt={attempt} caseId={caseId} sample={sample} subtitle={subtitle} popout />
      </div>
    </main>
  );
}
