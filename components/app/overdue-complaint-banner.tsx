import type { TopBarUrgent } from "@/components/app/app-top-bar";

/**
 * LA-6.4 · an overdue regulator complaint is the single loudest thing in the product: a missed DOI
 * deadline is an escalation toward losing the licence. Owner 2026-11-02: not a strip on the page, an
 * alert in the top bar — a red warning icon beside the bell on every page, and the first thing in the
 * Inbox, until the complaint is answered. It cannot be dismissed or marked read: it clears only when the
 * count does.
 */
export function overdueComplaintAlert(count: number): TopBarUrgent | null {
  if (count <= 0) return null;
  return {
    id: "overdue-regulator-complaint",
    // A short title and one line of why (owner, 2026-11-13: the Inbox's urgent card).
    text: count === 1 ? "Complaint past its deadline" : `${count} complaints past their deadline`,
    detail: "Your licence is at risk.",
    href: "/app/complaints",
    action: "Respond",
  };
}
