import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { ServicingGuideEditor } from "@/components/admin/servicing-guide-editor";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { loadGuides, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";

/** LA-5.4 (Notion sprint) · how each carrier takes a servicing change: platform content, for staff. */
export default async function AdminServicingGuidesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const view = await loadGuides();
  const written = view.carriers.filter((c) => Object.keys(c.guides).length > 0).length;
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Servicing instructions" subtitle={view.available ? "How each carrier takes a payment-date, payment, bill-to-draft or address change, in plain words, for agents opening a request." : undefined} />
      {view.available && (
        <StatStrip label="Servicing instruction totals">
          <StatTile label="Carriers" value={view.carriers.length.toLocaleString("en-US")} reserveFootnote />
          <StatTile label="With instructions" value={written.toLocaleString("en-US")} footnote={view.carriers.length ? `${Math.round((written / view.carriers.length) * 100)}% of carriers` : "no carriers"} />
          <StatTile label="Missing" value={(view.carriers.length - written).toLocaleString("en-US")} valueTone={view.carriers.length - written > 0 ? "warning" : undefined} footnote={view.carriers.length - written > 0 ? "agents see no help" : "every carrier covered"} />
        </StatStrip>
      )}
      {!view.available ? <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{SERVICING_PENDING_MESSAGE}</div> : <ServicingGuideEditor rows={view.carriers} />}
    </div>
  );
}
