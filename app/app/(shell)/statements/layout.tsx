import type { ReactNode } from "react";
import { DashboardStage } from "@/components/ui/dashboard-stage";

/** Commissions › Statements imported by hand (redesign 2026-10-26, Module 4): every page under this route on the moving ribbon. */
export default function Layout({ children }: { children: ReactNode }) {
  return <DashboardStage ribbon>{children}</DashboardStage>;
}
