import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { FirstStatement } from "@/components/app/setup/first-statement";

/**
 * Get set up › Statement first (ledger-r1 board 3·A, owner pick 2026-11-19): a Ledger agent's first money in one
 * upload and one confirm, instead of ten stops across Settings, Statements, Policies, the rate card and Pay issues.
 * The page is the client flow (components/app/setup/first-statement.tsx); the writes are app/api/app/statements/first.
 * Owner and bookkeeper, as every statement screen.
 */
export default async function FirstStatementPage() {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Statements" description="Drop a carrier commission statement and see the money it holds, checked against your book." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper." />;
  }
  const blocked = guard.entitlement.access === "read_only" ? "Setting up is paused while the account is read-only." : null;
  return <FirstStatement blocked={blocked} />;
}
