"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PlanDialog } from "@/components/admin/plan-dialog";
import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/**
 * The Plans title line's two buttons (catalog.html screen 2): Compare plans opens the compare sheet (`?compare=1`, a
 * server read) and New plan the create dialog. `?new=1` (the Catalog workspace's New plan) opens it on arrival.
 */
export function PlanHeaderActions() {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(() => params.get("new") === "1");

  function openCompare() {
    const next = new URLSearchParams(window.location.search);
    next.set("compare", "1");
    next.delete("plan");
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  function close() {
    setCreating(false);
    setParamsInPlace({ new: null });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openCompare}>Compare plans</Button>
      <Button type="button" onClick={() => setCreating(true)}>New plan</Button>
      <PlanDialog mode="create" open={creating} onClose={close} onSaved={() => router.refresh()} />
    </>
  );
}
