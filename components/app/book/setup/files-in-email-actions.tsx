"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendInbound } from "@/components/app/carrier-file-doors";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierChoice } from "@/lib/ingestion/path";
import { notify } from "@/lib/notify";

/**
 * Files in › Email, the title line's buttons (r7 4·1, 4·4): Add sender opens a dialog — carrier and sender, with the
 * error line under the field to fix — and Copy address (primary) copies the agency's own address. The same
 * add_sender call the toolbar form made. Paused while the account is read-only.
 */
export function FilesInEmailActions({ address, carriers, canWrite, writeBlockedReason }: {
  address: string | null;
  carriers: CarrierChoice[];
  canWrite: boolean;
  writeBlockedReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrierId, setCarrierId] = useState("");
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: "carrier" | "sender" | "form"; text: string } | null>(null);

  function reset() { setCarrierId(""); setSender(""); setProblem(null); }

  async function add() {
    if (!carrierId) return setProblem({ field: "carrier", text: "Choose the carrier this sender is." });
    if (!sender.trim()) return setProblem({ field: "sender", text: "Enter the sender's address or @domain." });
    setBusy(true);
    setProblem(null);
    try {
      await sendInbound("/api/app/carrier-files/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_sender", carrier_id: carrierId, sender }) });
      notify.done(`Added ${sender.trim()}.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch (reason) {
      setProblem({ field: "form", text: reason instanceof Error ? reason.message : "That did not work; try again." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      notify.done("Address copied.");
    } catch {
      notify.block("Copy it by hand: the browser refused.");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={!canWrite} title={writeBlockedReason ?? undefined} onClick={() => setOpen(true)}>Add sender</Button>
      {address && <Button type="button" onClick={() => void copy()}>Copy address</Button>}
      <Dialog open={open} onOpenChange={(next) => { if (busy) return; setOpen(next); if (!next) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a carrier sender</DialogTitle>
            <DialogDescription className="sr-only">The carrier, and the address or @domain its files come from.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4 text-sm" onSubmit={(event) => { event.preventDefault(); void add(); }}>
            <div className="grid gap-1.5">
              <Label htmlFor="sender-carrier">Carrier</Label>
              <select id="sender-carrier" className={`${toolbarControl} w-full`} value={carrierId} aria-invalid={problem?.field === "carrier" || undefined} onChange={(event) => { setCarrierId(event.target.value); setProblem(null); }}>
                <option value="">Carrier</option>
                {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
              </select>
              {problem?.field === "carrier" && <p role="alert" className="m-0 text-xs font-medium text-[var(--error-ink)]">{problem.text}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sender-address">Sender address or @domain</Label>
              <Input id="sender-address" className="h-9" placeholder="@carrier.com" value={sender} aria-invalid={problem?.field === "sender" || undefined} onChange={(event) => { setSender(event.target.value); setProblem(null); }} />
              {problem?.field === "sender"
                ? <p role="alert" className="m-0 text-xs font-medium text-[var(--error-ink)]">{problem.text}</p>
                : <p className="m-0 text-xs text-muted-foreground">commissions@carrier.com or @carrier.com</p>}
            </div>
            {problem?.field === "form" && <p role="alert" className="m-0 text-sm font-medium text-[var(--error-ink)]">{problem.text}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add sender"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
