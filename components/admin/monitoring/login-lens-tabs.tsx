"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { NavPending } from "@/components/ui/nav-pending";
import { ViewTabs } from "@/components/ui/view-tabs";
import { parseActivityLens, type ActivityLens } from "@/lib/loginEvents/present";

/**
 * Login activity's lenses on the title line (admin round 1, monitoring.html screen 2): All · Failed · Repeated
 * failures. "Failed" is the Outcome filter set to failed (`?outcome=failure`); "Repeated failures" is `?lens=repeated`.
 * A lens keeps the range, actor and search, and asks the server for the rows.
 */
export function LoginLensTabs({ failed, repeated }: { failed: number | null; repeated: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const lens = parseActivityLens(params);

  function choose(key: ActivityLens) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("attempt");
    next.delete("lens");
    next.delete("outcome");
    if (key === "failed") next.set("outcome", "failure");
    if (key === "repeated") next.set("lens", "repeated");
    const query = next.toString();
    start(() => router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false }));
  }

  const bar = (
    <ViewTabs
      label="Login activity views"
      value={lens}
      onChange={choose}
      tabs={[
        { key: "all", label: "All" },
        { key: "failed", label: "Failed", count: failed, tone: "danger" },
        { key: "repeated", label: "Repeated failures", count: repeated, tone: "danger" },
      ]}
    />
  );
  return (
    <>
      <NavPending pending={pending} />
      {bar}
    </>
  );
}
