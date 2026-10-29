import { confirmAction } from "@/components/ui/confirm-dialog";
import { IMPORT_CSV_KEY } from "@/lib/agentTemplates/importReviewModel";
import { notify } from "@/lib/notify";

/**
 * Review clean-up (owner 2026-10-29): "Discard this file", from the review and from the scrub that
 * stages it. The server marks the batch failed (DELETE /api/app/leads/import/batches/[id]) and never
 * touches an imported one; this tab then forgets the file, so the rail stops counting it.
 */

/** Drops the file this tab holds for a batch. Private windows may refuse; the tab then keeps it until it closes. */
export function forgetStagedFile(batchId: string) {
  try { sessionStorage.removeItem(`${IMPORT_CSV_KEY}:${batchId}`); } catch { /* nothing to forget */ }
}

/**
 * Asks, then discards. "done" when the file is gone (or was already not waiting), "imported" when it
 * turned out to be imported meanwhile, null when the person kept it or the request failed.
 */
export async function discardStagedFile(batchId: string, fileName: string | null): Promise<"done" | "imported" | null> {
  const ok = await confirmAction({
    title: "Discard this file?",
    description: `${fileName ?? "The file"} is not imported, and nothing from it reaches your leads. Upload it again to start over.`,
    confirmLabel: "Discard file",
    cancelLabel: "Keep reviewing",
  });
  if (!ok) return null;
  const response = await fetch(`/api/app/leads/import/batches/${batchId}`, { method: "DELETE" }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (response?.status === 409 && body?.state === "committed") {
    forgetStagedFile(batchId);
    notify.block(body?.error ?? "This file was already imported.");
    return "imported";
  }
  // 404: it is not waiting any more (discarded in another tab). Forgetting it here is the same end.
  if (!response || (!response.ok && response.status !== 404)) {
    notify.block(body?.error ?? "Could not discard this file");
    return null;
  }
  forgetStagedFile(batchId);
  notify.done(`${fileName ?? "The file"} discarded`);
  return "done";
}
