"use client";

import { useRouter } from "next/navigation";

import { CreateTenantDialog } from "@/components/admin/create-tenant-dialog";

/**
 * The header's Create tenant action. After a tenant is made the server page reads the list again
 * (router.refresh), so the new row, its plan and the four figures all come from the same query as
 * before — the dialog stays open meanwhile, showing the invitation link.
 */
export function TenantsListCreate() {
  const router = useRouter();
  return <CreateTenantDialog onCreated={() => router.refresh()} />;
}
