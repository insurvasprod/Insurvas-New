import { BookOpen, FileText, UsersRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PoliciesWorkspace } from "@/components/app/policies-workspace";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";

export default async function PoliciesPage() {
  const guard = await guardPage("book_of_business");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Book of business" description="Your policies, premiums and carriers in one place." eyebrow={sectionForPath("/app/policies") ?? undefined} />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Policies" detail="Your tenant role does not include the book of business." eyebrow={sectionForPath("/app/policies") ?? undefined} />;
  const readOnly = guard.entitlement.access === "read_only";
  // The header lives in the workspace: its Import and Add actions open the workspace's dialogs.
  // The guidance sits below the table, as the board has it once the book is populated.
  return <div className="flex flex-col gap-6">
    <PoliciesWorkspace readOnly={readOnly} eyebrow={sectionForPath("/app/policies") ?? undefined} />
    <section className="portal-policies-guides grid gap-4 lg:grid-cols-3" aria-label="Policy workspace guidance">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpen aria-hidden="true" />What appears here</CardTitle><CardDescription>Each policy with the key details needed at a glance.</CardDescription></CardHeader><CardContent><ul className="portal-policies-checklist"><li>Policy status</li><li>Insured and carrier</li><li>Premium and effective date</li><li>Renewal and lapse signals</li></ul></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText aria-hidden="true" />Import checklist</CardTitle><CardDescription>Use this information when preparing your policy CSV file.</CardDescription></CardHeader><CardContent><ul className="portal-policies-checklist"><li>Policy number</li><li>Insured name</li><li>Carrier and product</li><li>Effective date and premium</li><li>Optional status and renewal date</li></ul></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound aria-hidden="true" />Visibility &amp; controls</CardTitle><CardDescription>Access and permissions follow the tenant role.</CardDescription></CardHeader><CardContent><dl className="portal-policies-visibility"><div><dt>Owners</dt><dd>Full access to policies, settings, and data.</dd></div><div><dt>Producers</dt><dd>Access to assigned policies and clients.</dd></div><div><dt>Bookkeepers</dt><dd>Read policy and financial details.</dd></div><div><dt>Suspended users</dt><dd>Retain read-only historical access.</dd></div></dl></CardContent></Card>
    </section>
  </div>;
}
