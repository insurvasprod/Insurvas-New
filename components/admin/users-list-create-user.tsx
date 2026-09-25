"use client";

import { CreateUserDialog, type TenantOption } from "./create-user-dialog";
import type { PlanListRow } from "@/lib/plans/constants";

/**
 * Fired on window when the header's Create user finishes, so the list below (a separate client
 * island, because the header is rendered by the server page) refetches its rows and tiles.
 */
export const USERS_LIST_CHANGED_EVENT = "admin-users-list:changed";

/** The Users board's header action: a 44px primary "Create user" that opens the existing dialog. */
export function UsersListCreateUser({ tenants, plans }: { tenants: TenantOption[]; plans: PlanListRow[] }) {
  return (
    <CreateUserDialog
      tenants={tenants}
      plans={plans}
      onCreated={() => window.dispatchEvent(new Event(USERS_LIST_CHANGED_EVENT))}
      triggerLabel="Create user"
      triggerClassName="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--on-primary)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    />
  );
}
