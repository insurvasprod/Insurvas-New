import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { CarrierGuidanceEditor } from "@/components/admin/carrier-guidance-editor";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BOOK_IMPORT_PENDING_MESSAGE, loadGuidance } from "@/lib/ingestion/bookImport";

/** LA-4.10 (Notion sprint) · portal guidance for the book import: platform content, for staff. */
export default async function AdminCarrierGuidancePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const view = await loadGuidance();
  const missing = view.carriers.filter((c: { guidance: unknown }) => !c.guidance).length;
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Portal guidance" subtitle={view.available ? `Where each carrier keeps its policy file, in plain words, for agencies importing their book. ${missing} of ${view.carriers.length} carriers have none yet.` : undefined} />
      {!view.available ? <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{BOOK_IMPORT_PENDING_MESSAGE}</div> : <CarrierGuidanceEditor rows={view.carriers} />}
    </div>
  );
}
