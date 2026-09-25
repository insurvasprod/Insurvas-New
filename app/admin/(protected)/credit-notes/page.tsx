import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { CreditNotesTable, type CreditNoteRow } from "@/components/admin/credit-notes-table";
import { RaiseCreditNotePicker } from "@/components/admin/raise-credit-note-picker";
import { formatCentsAsCurrency } from "@/lib/money";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";

const PRIMARY_44 =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--on-primary)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

function Callout({ tone, title, children }: { tone: "warning" | "error"; title: string; children: React.ReactNode }) {
  const edge = tone === "error" ? "border-l-[var(--error)] bg-[var(--error-surface)]" : "border-l-[var(--warning)] bg-[var(--warning-surface)]";
  const ink = tone === "error" ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]";
  return (
    <div role="status" className={`rounded-[12px] border border-[var(--border)] border-l-[3px] px-4 py-3.5 ${edge}`}>
      <p className={`text-[14px] font-semibold ${ink}`}>{title}</p>
      <p className="mt-1.5 text-[14px] leading-normal text-[var(--body)]">{children}</p>
    </div>
  );
}

export default async function CreditNotesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const supabase = getSupabaseServiceClient();
  const [thresholdCents, notesResult, paidResult] = await Promise.all([
    refundApprovalThresholdCents(),
    supabase.from("credit_notes").select("*, tenants(name), invoice:platform_invoices(id, number)").order("created_at", { ascending: false }),
    supabase.from("platform_invoices").select("id, number, total_cents, tenants(name)").eq("status", "paid").order("number", { ascending: false }).limit(500),
  ]);

  // This screen holds the pending-approval queue. A failed query renders it empty, which reads as
  // "nothing is waiting on you" — the one wrong answer, since a refund sitting unapproved is the
  // whole reason to open the page.
  if (notesResult.error) throw new Error(`Could not load credit notes: ${notesResult.error.message}`);

  const notes = (notesResult.data ?? []) as unknown as CreditNoteRow[];
  const pending = notes.filter((n) => n.status === "pending_approval");
  const ownPending = pending.filter((n) => n.requested_by === admin.id);
  const failed = notes.filter((n) => n.status === "failed");
  const providerPending = notes.filter((n) => n.reconciliation_state === "provider_pending");
  const paid = ((paidResult.data ?? []) as unknown as Array<{ id: string; number: string; total_cents: number; tenants: { name: string } | null }>).map((row) => ({ id: row.id, number: row.number, total_cents: row.total_cents, tenant_name: row.tenants?.name ?? "—" }));
  const names = (rows: CreditNoteRow[]) => rows.slice(0, 3).map((n) => n.number).join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "");

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Refunds & credits"
        subtitle={`Refunds above ${formatCentsAsCurrency(thresholdCents)} need a second admin. The threshold comes from settings.`}
        actions={<RaiseCreditNotePicker invoices={paid} className={PRIMARY_44} />}
      />
      <BillingTabs />

      {(pending.length > 0 || failed.length > 0 || providerPending.length > 0) && (
        <div className="flex flex-col gap-3">
          {pending.length > 0 && (
            <Callout tone="warning" title={`${pending.length} pending approval`}>
              No money moves until a second admin approves.{" "}
              {ownPending.length > 0
                ? <><strong className="font-semibold text-[var(--ink)]">You cannot approve one you raised yourself</strong> — {names(ownPending)} {ownPending.length === 1 ? "is" : "are"} yours.</>
                : "You cannot approve one you raised yourself."}
            </Callout>
          )}
          {failed.length > 0 && (
            <Callout tone="error" title={`${failed.length} failed at the provider`}>
              The credit note is kept in <code className="rounded bg-[var(--surface)] px-1 text-[14px]">failed</code> so the attempt is on record. Investigate before retrying: the money may or may not have moved. {names(failed)}.
            </Callout>
          )}
          {providerPending.length > 0 && (
            <Callout tone="warning" title={`${providerPending.length} awaiting local reconciliation`}>
              The provider may already have accepted {providerPending.length === 1 ? "this refund" : "these refunds"}. Retry reconciliation to check the same idempotent request. <strong className="font-semibold text-[var(--ink)]">Do not raise a second credit note.</strong>
            </Callout>
          )}
        </div>
      )}

      <CreditNotesTable notes={notes} currentAdminId={admin.id} />
    </div>
  );
}
