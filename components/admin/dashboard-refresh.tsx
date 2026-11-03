"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { RefreshButton } from "@/components/ui/data-toolbar";

/** Re-reads a server-rendered admin page in place (the daily checks on the admin home). */
export function DashboardRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <RefreshButton onClick={() => startTransition(() => router.refresh())} refreshing={pending} />;
}
