"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/** Sent once Check now has read the bucket, so the day's table (carrier-bucket.tsx) reads its day again. */
export const BUCKET_CHECKED_EVENT = "files-in:bucket-checked";

/** The bucket's folder for a day (MM-DD-YYYY), or its pattern. */
export const bucketFolder = (tenantId: string, day?: string) =>
  `carrier-files/${tenantId}/${day ? `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}` : "MM-DD-YYYY"}/<agency>/<carrier>/<Policies | Commissions | New Business>/`;

export async function copyFolder(folder: string) {
  try {
    await navigator.clipboard.writeText(folder);
    notify.done("Folder copied.");
  } catch {
    notify.block("Copy it by hand: the browser refused.");
  }
}

/**
 * Files in › Bucket, the title line's buttons (r7 4·2): Copy the folder, and Check now (primary), which reads the
 * bucket at once instead of at the next five-minute poll — the same check_now call the toolbar button made.
 * Read-only: Check now is disabled and says why.
 */
export function FilesInBucketActions({ tenantId, blocked }: { tenantId: string; blocked: string | null }) {
  const [busy, setBusy] = useState(false);

  async function checkNow() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/carrier-files/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check_now" }) });
      const data = (await response.json().catch(() => ({}))) as { registered?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The bucket could not be checked.");
      notify.done(data.registered ? `Checked: ${data.registered} ${data.registered === 1 ? "file" : "files"} read.` : "Checked: nothing new in the bucket.");
      window.dispatchEvent(new Event(BUCKET_CHECKED_EVENT));
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The bucket could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => void copyFolder(bucketFolder(tenantId))}>Copy the folder</Button>
      <Button type="button" disabled={busy || blocked !== null} title={blocked ?? undefined} onClick={() => void checkNow()}>{busy ? "Checking…" : "Check now"}</Button>
    </>
  );
}
