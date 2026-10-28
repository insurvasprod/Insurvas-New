import type { ReactNode } from "react";
import { DashboardStage } from "@/components/ui/dashboard-stage";

/** Commissions › Owed to you (redesign 2026-10-26, Module 4): every page under this route on the static stage backdrop. */
export default function Layout({ children }: { children: ReactNode }) {
  return <DashboardStage>{children}</DashboardStage>;
}
