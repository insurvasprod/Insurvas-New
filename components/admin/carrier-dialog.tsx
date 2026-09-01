"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CarrierRow } from "@/lib/carriers/constants";
import { CARRIER_CODE_RULE } from "@/lib/carriers/constants";

export function CarrierDialog({ open, carrier, onClose, onSaved }: { open: boolean; carrier?: CarrierRow | null; onClose: () => void; onSaved: () => void }) {
  const edit = Boolean(carrier);
  const [code, setCode] = useState(carrier?.code ?? "");
  const [name, setName] = useState(carrier?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(carrier?.sort_order ?? 0));
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true);
    const response = await fetch(edit ? `/api/admin/carriers/${carrier!.id}` : "/api/admin/carriers", {
      method: edit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, sort_order: sortOrder }),
    });
    const body = await response.json().catch(() => null); setLoading(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not save carrier"); return; }
    toast.success(edit ? `${name} updated` : `${name} added`); onSaved(); onClose();
  }

  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent>
    <form onSubmit={submit}><DialogHeader><DialogTitle>{edit ? "Edit carrier" : "New carrier"}</DialogTitle><DialogDescription>{edit ? "The carrier code is a stable reference. Archive it when it is no longer offered." : "Agents will be able to choose this carrier without a deploy."}</DialogDescription></DialogHeader>
      <div className="space-y-4 py-4"><div className="space-y-1.5"><Label htmlFor="carrier-code">Carrier code</Label><Input id="carrier-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={edit} required placeholder="e.g. mutual_of_omaha" /><p className="text-xs text-muted-foreground">{CARRIER_CODE_RULE}.</p></div><div className="space-y-1.5"><Label htmlFor="carrier-name">Name</Label><Input id="carrier-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Mutual of Omaha" /></div><div className="space-y-1.5"><Label htmlFor="carrier-sort-order">Sort order</Label><Input id="carrier-sort-order" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div></div>
      <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Saving…" : edit ? "Save changes" : "Add carrier"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
