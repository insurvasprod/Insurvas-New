import type { AdminRole } from "@/lib/adminAuth/roles";

/** The signed-in admin as every dashboard tab receives it: the role decides what each tab shows and links to. */
export type DashboardAdmin = { id: string; role: AdminRole };
