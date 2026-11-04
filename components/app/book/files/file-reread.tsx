"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { notify } from "@/lib/notify";

/**
 * LA-4.2 · "Read again" on a file's page: the file is read again from its kept raw rows with its carrier's current
 * layout, after a layout or a status word is fixed. Nothing is uploaded again; the run is recorded (Run history).
 *
 * It changes the book (rows are re-linked, policies updated, cards moved), so it asks first (UI-CONSISTENCY §11:
 * the kit's confirm, one plain line of what happens). Replaces components/app/carrier-file-reread.tsx on this page,
 * which ran on the click.
 */
export function FileReread({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function reread() {
    const ok = await confirmAction({
      title: "Read this file again?",
      description: "Its kept rows are read again with the carrier's current layout, and any policy, link or card they change is updated.",
      confirmLabel: "Read again",
      cancelLabel: "Keep as it is",
      destructive: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch("/api/app/carrier-files/reprocess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId }) });
      const data = (await response.json().catch(() => ({}))) as { status?: string; errorDetail?: string | null; rowsChanged?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The file could not be read again.");
      if (data.status === "failed") notify.block(data.errorDetail?.replace(/^File [0-9a-f-]+ could not be read: /, "") ?? "The file could not be read.");
      else notify.done(data.rowsChanged ? `Read again: ${data.rowsChanged.toLocaleString("en-US")} ${data.rowsChanged === 1 ? "change" : "changes"}.` : "Read again: nothing changed.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The file could not be read again.");
    } finally {
      setBusy(false);
    }
  }
  return <Button type="button" variant="outline" disabled={busy} onClick={() => void reread()} title="Read the kept rows again with the carrier's current layout"><RotateCw aria-hidden="true" />{busy ? "Reading…" : "Read again"}</Button>;
}
