import type { AdminRole } from "@/lib/adminAuth/roles";

// A state calling rule decides, for every tenant's dialer, when a call is legal. User decision
// 2026-09-29: super admins maintain it. Read and write share the one list.
export const CAN_MANAGE_CALLING_RULES: readonly AdminRole[] = ["super_admin"];
