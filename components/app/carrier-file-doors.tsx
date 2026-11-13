"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import type { SenderRow } from "@/lib/ingestion/registry";
import { notify } from "@/lib/notify";

export async function sendInbound(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "That did not work; try again.");
}

const UNKNOWN_SENDER = "A file from an unknown sender still arrives, but waits until its carrier is known.";

/**
 * LA-4.1 (Notion sprint) · the email door: the agency's own address, and the carriers' known senders that tell the
 * pipeline which carrier an emailed file is from (exact address, or a whole @domain).
 *
 * r7 4·1 (owner 2026-11-10): Files in's Email tab. The address heads the card; the senders are the table. Adding a
 * sender is a dialog from the title line (files-in-email-actions.tsx), not a form in the toolbar. An agency sender's
 * row opens a small dialog with its carrier and Remove, and Remove asks first (it removed at once before).
 * Insurvas's senders are kept by Insurvas and do not open. Errors are toasts, not a red box above the table.
 */
export function CarrierFileDoors({
  address,
  addressConfigured,
  senders,
  canWrite,
  writeBlockedReason,
}: {
  address: string | null;
  addressConfigured: boolean;
  senders: SenderRow[];
  canWrite: boolean;
  writeBlockedReason: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<SenderRow | null>(null);

  async function createAddress() {
    setBusy("address");
    try {
      await sendInbound("/api/app/carrier-files/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_address" }) });
      notify.done("Address created. Give it to each carrier.");
      router.refresh();
    } catch (reason) {
      notify.block(reason instanceof Error ? reason.message : "That did not work; try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: SenderRow) {
    setOpen(null);
    const yes = await confirmAction({ title: `Remove ${row.sender}?`, description: "Files from it still arrive, but wait until their carrier is known.", confirmLabel: "Remove", cancelLabel: "Keep it" });
    if (!yes) return;
    setBusy(`remove-${row.id}`);
    try {
      await sendInbound(`/api/app/carrier-files/inbound?sender_id=${row.id}`, { method: "DELETE" });
      notify.done(`Removed ${row.sender}.`);
      router.refresh();
    } catch (reason) {
      notify.block(reason instanceof Error ? reason.message : "That did not work; try again.");
    } finally {
      setBusy(null);
    }
  }

  const head = (
    <div className="grid gap-0.5 px-4 py-3">
      {address ? (
        <>
          <span className="break-all font-mono text-sm text-foreground">{address}</span>
          <span className="text-xs text-muted-foreground">Forward carrier files here. Each CSV, Excel or PDF attachment is received as its own file.</span>
        </>
      ) : null}
    </div>
  );

  return (
    <>
      <PagedTableCard
        total={senders.length}
        noun="senders"
        suffix={UNKNOWN_SENDER}
        toolbar={address ? head : undefined}
        footer={
          <div className="flex w-full flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{UNKNOWN_SENDER}</span>
            <span className="ml-auto tabular-nums">{senders.length.toLocaleString("en-US")} {senders.length === 1 ? "sender" : "senders"}</span>
          </div>
        }
      >
        {!address ? (
          addressConfigured ? (
            <EmptyState
              title="No address yet"
              hint="Give the agency its own address, then forward carrier files to it."
              action={<Button type="button" disabled={!canWrite || busy !== null} title={writeBlockedReason ?? undefined} onClick={() => void createAddress()}>{busy === "address" ? "Creating…" : "Create address"}</Button>}
            />
          ) : (
            <EmptyState title="Email-in is not switched on yet" hint="Email-in is not switched on for this workspace yet. Upload files, or have them dropped in the bucket, meanwhile." />
          )
        ) : null}
        {address && senders.length === 0 ? (
          <EmptyState title="No known carrier senders" hint="Add each carrier's sending address, so its files are recognised. A file from an unknown sender is still received, and waits until its carrier is known." />
        ) : senders.length > 0 ? (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Sender</th>
                <th>Carrier</th>
                <th className="w-[140px]">Added by</th>
                <th className="w-[150px]">Next step</th>
              </tr>
            </thead>
            <PagedBody>
              {senders.map((row) => (
                <tr key={row.id} className={row.platform ? undefined : "cursor-pointer"} onClick={row.platform ? undefined : () => setOpen(row)}>
                  <td className="whitespace-nowrap font-medium text-foreground">
                    {row.platform ? <span>{row.sender}</span>
                      : <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(row); }}>{row.sender}</button>}
                  </td>
                  <td className="whitespace-nowrap">{row.carrierName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">{row.platform ? "Insurvas" : "This agency"}</td>
                  <td className="whitespace-nowrap">
                    {row.platform ? <span className="text-muted-foreground" title="Kept by Insurvas">—</span> : busy === `remove-${row.id}` ? "Removing…" : "Open ›"}
                  </td>
                </tr>
              ))}
            </PagedBody>
          </table>
        ) : null}
      </PagedTableCard>

      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-all">{open?.sender}</DialogTitle>
            <DialogDescription>Files sent from it are read as {open?.carrierName ?? "its carrier"}&apos;s.</DialogDescription>
          </DialogHeader>
          <dl className="m-0 grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Carrier</dt><dd className="m-0 text-[var(--body)]">{open?.carrierName ?? "—"}</dd>
            <dt className="text-xs text-muted-foreground">Added by</dt><dd className="m-0 text-[var(--body)]">This agency</dd>
          </dl>
          <DialogFooter>
            <Button type="button" variant="outline" className="text-[var(--error-ink)] sm:mr-auto" disabled={!canWrite || busy !== null} title={writeBlockedReason ?? undefined} onClick={() => { if (open) void remove(open); }}>Remove</Button>
            <Button type="button" onClick={() => setOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
