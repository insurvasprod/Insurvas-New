"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";

/** The carrier-file pay issues' writes (POST /api/app/commission-discrepancies), with the route's own error words. */
export async function postPayIssue(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/app/commission-discrepancies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work.");
  return data;
}

/** A hand-statement finding's decision (PATCH /api/app/discrepancies/[id]). */
export async function patchHandIssue(id: string, status: "open" | "disputed" | "resolved" | "written_off", note: string | null) {
  const response = await fetch(`/api/app/discrepancies/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, note }) });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The decision was not recorded.");
}

export const READ_ONLY_HINT = "Paused while the account is read-only.";

/** "Check now" on the title line: the carrier files read again against the latest rules and rates. */
export function CheckNowButton({ readOnly, label = "Check now", variant = "outline" }: { readOnly: boolean; label?: string; variant?: "outline" | "default" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const data = await postPayIssue({ action: "run" });
      if (data.available === false) notify.warn("Nothing to check yet.", { detail: "Pay issues from carrier files are not switched on for this account yet." });
      else notify.done("Checked against the latest files.", { detail: `${Number(data.opened ?? 0).toLocaleString("en-US")} new · ${Number(data.cleared ?? 0).toLocaleString("en-US")} settled` });
      refreshStepCounts();
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The check did not run.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span title={readOnly ? READ_ONLY_HINT : undefined}>
      <Button type="button" variant={variant} disabled={readOnly || busy} onClick={() => void run()}>{busy ? "Checking" : label}</Button>
    </span>
  );
}
