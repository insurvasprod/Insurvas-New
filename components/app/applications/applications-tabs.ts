import { hasFeature, type Entitlement } from "@/lib/entitlements/types";
import type { ApplicationsTab } from "./applications-hub";

/**
 * The Applications page's tabs (2026-10-26): each one is the page it replaced, at its own address and
 * behind its own plan feature, so a tab shows only when its page would open.
 */
export function applicationsTabs(entitlement: Entitlement): ApplicationsTab[] {
  const tabs: ApplicationsTab[] = [];
  if (hasFeature(entitlement, "applications")) {
    tabs.push({ key: "cases", label: "Cases", href: "/app/applications" });
    tabs.push({ key: "waiting", label: "Waiting on the carrier", href: "/app/pending" });
  }
  if (hasFeature(entitlement, "quoting")) tabs.push({ key: "quotes", label: "Quotes", href: "/app/quoting" });
  return tabs;
}

/** May open the draft-date calculator from the header. */
export function hasCalculator(entitlement: Entitlement) {
  return hasFeature(entitlement, "draft_date_optimizer");
}
