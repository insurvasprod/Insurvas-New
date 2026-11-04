import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";

import SetupFilesInPage from "../book-setup/how-files-arrive/page";

/**
 * Book of Business › Import your book (LA-4.10): since the Setup redesign (board 8) "Bring your existing book" is a
 * section of Setup › Files in. This older address renders that same page, so every link, checklist step and email
 * that names /app/book-import still lands on it. The gate is written here too (the producer-isolation audit reads
 * the page's own gate): owner and bookkeeper, like every Setup tab and the import's API. Opening it writes nothing.
 */
export default async function BookImportPage(props: { searchParams: Promise<{ date?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Import your book" description="Bring in your existing book from each carrier's latest policy file." />;
  if (!actAsPagePermission(guard, "statements.view") || !actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Import your book" detail="The book is imported by the account owner or a bookkeeper." />;
  return <SetupFilesInPage {...props} />;
}
