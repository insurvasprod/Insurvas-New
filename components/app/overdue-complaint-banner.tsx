import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { PageAlert } from "@/components/ui/page-alert";

/**
 * LA-6.4 · an overdue regulator complaint is the single loudest thing in the product: an alert on
 * every page that cannot be dismissed, until the complaint is answered. A missed DOI deadline is an
 * escalation toward losing the licence. It sits on the page title's line (owner 2026-11-02), red.
 */
export function OverdueComplaintBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <PageAlert
      role="alert"
      tone="error"
      icon={<TriangleAlert />}
      text={`${count === 1 ? "A regulator complaint is past its response deadline." : `${count} regulator complaints are past their response deadline.`} A missed deadline puts the licence at risk.`}
      action={<Link href="/app/complaints">Respond now</Link>}
    />
  );
}
