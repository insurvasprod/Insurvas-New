"use client";

import { useSearchParams } from "next/navigation";

import { setParamsInPlace } from "@/components/ui/nav-pending";
import { ViewTabs } from "@/components/ui/view-tabs";

/** Lockouts' lenses on the title line: Locked now (default) · All recorded (`?show=all`), switched in place. */
export function LockTabs({ locked, recorded }: { locked: number | null; recorded: number | null }) {
  const params = useSearchParams();
  const value = params.get("show") === "all" ? "all" : "locked";
  return (
    <ViewTabs
      label="Lockout views"
      value={value}
      onChange={(key) => setParamsInPlace({ show: key === "all" ? "all" : null, page: null })}
      tabs={[
        { key: "locked", label: "Locked now", count: locked, tone: "danger" },
        { key: "all", label: "All recorded", count: recorded },
      ]}
    />
  );
}
