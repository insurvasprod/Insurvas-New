type ProvisioningError = { code: "tenant_provisioning_unavailable" | "provisioning_failed"; message: string; status: 400 | 500 | 503 };

const MISSING_PROVISIONING_RPC = /admin_attach_user_to_tenant_with_plan|schema cache|could not find the function/i;

export const TENANT_PROVISIONING_UNAVAILABLE_MESSAGE =
  "New-tenant provisioning is temporarily unavailable while its database contract is being updated. No account was created. Please try again later.";

export function classifyProvisioningError(error: { code?: string | null; message?: string | null } | null | undefined): ProvisioningError {
  const detail = `${error?.code ?? ""} ${error?.message ?? ""}`;
  if (MISSING_PROVISIONING_RPC.test(detail)) {
    return { code: "tenant_provisioning_unavailable", message: TENANT_PROVISIONING_UNAVAILABLE_MESSAGE, status: 503 };
  }
  return { code: "provisioning_failed", message: "Could not create user", status: 500 };
}
