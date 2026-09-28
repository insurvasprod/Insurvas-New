import { redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

const destinations = [
  ["Invoices", "What we billed, and whether it matches what the provider charged.", "/admin/invoices"],
  [
    "Coupons",
    "Price breaks that apply at the payment provider, so the customer is really charged less.",
    "/admin/coupons",
  ],
  ["Refunds & credits", "Credit notes, their approvals, and what the provider actually did.", "/admin/credit-notes"],
  ["Revenue", "Contracted revenue, collections, churn and plan mix.", "/admin/revenue"],
] as const;

export default async function BillingWorkspacePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Billing" />
      <BillingTabs />
      <div className="grid gap-6 sm:grid-cols-2">
        {destinations.map(([title, description, href]) => (
          // The whole card is the link, so its accessible name carries the title and "Open" alone
          // is not ambiguous to a screen reader.
          <Link key={href} href={href} className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card interactive className="h-full">
              <CardContent>
                <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
                <p className="mt-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                  Open
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none"
                  >
                    <path d="M5 12h14m0 0-6-6m6 6-6 6" />
                  </svg>
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
