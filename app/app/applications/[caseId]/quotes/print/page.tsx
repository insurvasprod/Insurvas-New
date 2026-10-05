import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { SampleDataNotice } from "@/components/app/applications/parts";
import { SetupPending } from "@/components/app/applications/setup-pending";
import { ClientQuoteSheet } from "@/components/app/applications/quotes/client-quote-sheet";
import { PRODUCT_LABEL } from "@/lib/applications/constants";
import { ApplicationError } from "@/lib/applications/db";
import { FIXTURE_CASE } from "@/lib/applications/fixtures";
import { isUuid } from "@/lib/applications/http";
import { getCaseView } from "@/lib/applications/service";
import type { CaseView } from "@/lib/applications/types";
import { loadPrintContext } from "@/lib/quotes/printView";
import type { PrintQuote } from "@/lib/quotes/plainWords";

export const metadata: Metadata = { title: "Your coverage options" };

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const WHOLE_LIFE_CODES = new Set(["final_expense", "whole_life"]);

/**
 * /app/applications/[caseId]/quotes/print — the client's copy of the quote comparison (LA-3.5; board
 * l3-quotes-print). Deliberately OUTSIDE the (shell) route group so no sidebar or top bar renders:
 * it is shared on screen or printed. It reads the real case and shows every quote for the insured
 * that has not been discarded. `?preview=sample` renders the fixtures, outside production only.
 */
export default async function ClientQuotesPrintPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gated on `applications`, like the in-case quote, select and catalogue routes: the client's copy
  // belongs to the case, and the standalone Quoting list's kill switch must not take it down.
  const guard = await guardPage("applications");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Applications" description="Take a sale from the health interview to the carrier's policy number in one place." />;
  if (guard.role !== "owner" && guard.role !== "producer") return <RoleGateNotice featureLabel="Applications" detail="Owners and producers work applications." />;
  const [{ caseId }, query] = await Promise.all([params, searchParams]);

  const sample = single(query.preview) === "sample" && process.env.NODE_ENV !== "production";
  let caseView: CaseView;
  if (sample) caseView = FIXTURE_CASE;
  else {
    if (!isUuid(caseId)) notFound();
    try {
      caseView = await getCaseView(guard.context.tenantId, caseId);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "CASE_NOT_FOUND") notFound();
      if (error instanceof ApplicationError && error.code === "SCHEMA_PENDING") return <SetupPending title="Your coverage options" />;
      throw error;
    }
  }

  const insured = single(query.insured) === "spouse" ? "spouse" : "primary";
  const attemptNo = Number(single(query.attempt)) || null;
  const mine = caseView.attempts.filter((a) => a.insuredRole === insured).sort((a, b) => a.attemptNo - b.attemptNo);
  const attempt = (attemptNo ? mine.find((a) => a.attemptNo === attemptNo) : undefined) ?? mine.find((a) => a.status !== "closed") ?? mine[mine.length - 1];
  if (!attempt) notFound();

  const wanted = new Set((single(query.q) ?? "").split(",").filter(Boolean));
  const quotes = attempt.quotes.filter((q) => q.status !== "discarded" && (wanted.size === 0 || wanted.has(q.id)));

  const context = sample
    ? { agencyName: null, agent: null, productCodes: {} as Record<string, string> }
    : await loadPrintContext({ tenantId: guard.context.tenantId, userId: guard.context.userId, clientState: text(attempt.values["addr.state"]?.value) || caseView.clientState, quoteIds: quotes.map((q) => q.id) });

  const codeOf = (id: string) => context.productCodes[id] ?? attempt.productCode ?? "final_expense";
  const printQuotes: PrintQuote[] = quotes.map((q) => ({
    id: q.id, carrierName: q.carrierName, productLabel: q.productLabel, tier: q.tier, faceAmountCents: q.faceAmountCents,
    monthlyPremiumCents: q.monthlyPremiumCents, annualPremiumCents: q.annualPremiumCents ?? null, termLength: q.termLength ?? null,
    wholeLife: !q.termLength && WHOLE_LIFE_CODES.has(codeOf(q.id)),
  }));

  const codes = [...new Set(quotes.map((q) => codeOf(q.id)))];
  const productLine = codes.length === 1
    ? `${PRODUCT_LABEL[codes[0]] ?? codes[0]}${codes[0] !== "whole_life" && printQuotes.every((q) => q.wholeLife) ? " · whole life" : codes[0] !== "term_life" && printQuotes.every((q) => q.termLength) ? " · term" : ""}`
    : null;

  const first = text(attempt.values["insured.first_name"]?.value);
  const last = text(attempt.values["insured.last_name"]?.value);
  const clientName = [first, last].filter(Boolean).join(" ") || caseView.clientName;
  const callName = first || clientName.split(" ")[0] || "the insured";
  const dateLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <ClientQuoteSheet
      agencyName={context.agencyName}
      productLine={productLine}
      clientName={clientName}
      callName={callName}
      dateLabel={dateLabel}
      quotes={printQuotes}
      draftDay={attempt.payment?.draftDay ?? null}
      agent={context.agent}
      notice={sample ? <SampleDataNotice /> : undefined}
    />
  );
}
