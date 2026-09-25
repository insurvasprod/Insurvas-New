import type { CurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";

/**
 * What every tab of the admin tenant record receives. Each tab is a server component that fetches
 * only its own data, so opening one tab never pays for the others.
 */
export type TenantTabProps = {
  tenantId: string;
  admin: CurrentAdmin;
};

export const TENANT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "subscription", label: "Subscription & billing" },
  { key: "users", label: "Users & seats" },
  { key: "features", label: "Feature overrides" },
  { key: "activity", label: "Activity" },
] as const;

export type TenantTabKey = (typeof TENANT_TABS)[number]["key"];

export function tenantTabFrom(value: string | string[] | undefined): TenantTabKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return TENANT_TABS.some((tab) => tab.key === raw) ? (raw as TenantTabKey) : "overview";
}
