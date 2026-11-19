"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/**
 * "Test connection" on the Payment provider title line (kept): makes a real authenticated request to Whop, which the
 * route records in provider_calls and the audit log, then reads the page again so the checks move with it. The
 * route's own reason is shown on both paths — never a generic "something went wrong".
 */
export function ProviderTestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/payments/test-connection", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) notify.fail(body?.error ?? `The test could not run (HTTP ${res.status}).`);
      else if (body?.ok) notify.done(body?.message ?? "Whop answered and accepted the key.");
      else notify.fail(body?.message ?? body?.error ?? "No answer from the test.");
      router.refresh();
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={() => void test()} disabled={busy} title="Makes a real authenticated request and records it in the checks">
      {busy ? "Testing…" : "Test connection"}
    </Button>
  );
}
