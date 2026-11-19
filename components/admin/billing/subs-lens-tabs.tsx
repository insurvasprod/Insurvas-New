"use client";

import { useSearchParams } from "next/navigation";

import { setParamsInPlace } from "@/components/ui/nav-pending";
import { ViewTabs } from "@/components/ui/view-tabs";
import { SUBS_LENSES, readSubsFilters, type SubsLens } from "@/lib/subscriptionsList/filters";

/**
 * The Subscriptions lenses on the title's line (billing-r2 screen 2): All · Past due · Cancelling · Queued changes ·
 * Renews in 7 days. The lens lives in the address (`?lens=`) and changes in place: every row is already here.
 */
export function SubsLensTabs({ counts }: { counts: Record<SubsLens, number> | null }) {
  const params = useSearchParams();
  const lens = readSubsFilters(params).lens;
  return (
    <ViewTabs
      label="Subscription views"
      value={lens}
      onChange={(key) => setParamsInPlace({ lens: key === "all" ? null : key })}
      tabs={SUBS_LENSES.map((item) => ({ key: item.key, label: item.label, count: counts ? counts[item.key] : null, tone: item.key === "past_due" ? "danger" : undefined }))}
    />
  );
}
