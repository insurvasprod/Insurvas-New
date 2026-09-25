"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  ["/admin/billing", "Overview"],
  ["/admin/invoices", "Invoices"],
  ["/admin/coupons", "Coupons"],
  ["/admin/credit-notes", "Refunds & credits"],
  ["/admin/revenue", "Revenue"],
] as const;

/**
 * The billing workspace's tabs, drawn as the boards draw them: an underline strip, 40px tall, the
 * current tab in ink with a 2px primary rule. An invoice's own pages count as Invoices.
 */
export function BillingTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Billing workspace" className="flex gap-6 overflow-x-auto border-b border-[var(--border)]">
      {tabs.map(([href, label]) => {
        const active = pathname === href || (href === "/admin/invoices" && pathname.startsWith("/admin/invoices/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center border-b-2 px-1 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
              active ? "border-[var(--primary)] text-[var(--ink)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
