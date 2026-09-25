import type { AdminRole } from "@/lib/adminAuth/roles";

// A published disclosure is read by every tenant's dialer and is the thing an agent is required to
// read aloud, so it is platform compliance copy rather than billing data. It follows the same
// boundary as the compliance vendor registry.
export const CAN_MANAGE_STATE_DISCLOSURES: readonly AdminRole[] = ["super_admin", "platform_config"];
