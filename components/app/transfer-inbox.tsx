"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Item = { id: string; leadId: string; customer: string; age: string; state: string; productLine: string; partnerName: string; status: string; ownerName: string | null; waitSeconds: number; screeningOutcome: string; screeningWarning: string | null; duplicateWarning: boolean; preflightStatus: string; preflight: { matches?: Array<{ leadId: string | null; partnerName: string | null; outcome: string | null }> } | null; queuedAt: string };
type Handoff = { id: string; workItemId: string; bufferName: string; productLine: string; customer: string; progressPercentage: number; expiresAt: string };
type Data = { items: Item[]; partners: Array<{ id: string; name: string }>; products: string[]; states: string[]; claimedUsers: Array<{ id: string; name: string }>; handoffs: Handoff[] };

function waitLabel(seconds: number) {
  if (seconds < 60) return `${seconds}s waiting`;
  return `${Math.floor(seconds / 60)}m waiting`;
}

export function TransferInbox({ readOnly, role }: { readOnly: boolean; role: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("unclaimed");
  const [partnerId, setPartnerId] = useState("");
  const [productLine, setProductLine] = useState("");
  const [state, setState] = useState("");
  const [screeningOutcome, setScreeningOutcome] = useState("");
  const [claimedBy, setClaimedBy] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status });
    if (partnerId) params.set("partner_id", partnerId);
    if (productLine) params.set("product_line", productLine);
    if (state) params.set("state", state);
    if (screeningOutcome) params.set("screening_outcome", screeningOutcome);
    if (claimedBy) params.set("claimed_by", claimedBy);
    const response = await fetch(`/api/app/inbound?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load transfer inbox"); return; }
    setError(""); setData(body);
  }, [claimedBy, partnerId, productLine, screeningOutcome, state, status]);

  // The interval synchronizes this client view with the external inbox state; it is intentionally
  // not a derived render calculation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 1000); return () => window.clearInterval(timer); }, [load]);

  async function claim(id: string) {
    setClaiming(id);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: id }) });
    const body = await response.json().catch(() => null);
    setClaiming(null);
    if (response.status === 409) { toast.error(body?.error ?? "This transfer was already claimed"); void load(); return; }
    if (!response.ok) { toast.error(body?.error ?? "Could not claim this transfer"); return; }
    toast.success(body?.chatPosted === false ? "Transfer claimed; partner update could not be posted" : "Transfer claimed and call opened");
    router.push(`/app/inbound/${id}/verification`);
  }

  async function accept(handoffId: string, workItemId: string) {
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { toast.error(body?.error ?? "This handoff is no longer available"); void load(); return; }
    toast.success("Handoff accepted; verification is ready to resume");
    router.push(`/app/inbound/${workItemId}/verification`);
  }

  if (error) return <Card><CardContent className="space-y-3 p-6"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></CardContent></Card>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading transfer inbox…</p>;

  return <div className="mx-auto max-w-7xl space-y-6">
    <div><h1 className="text-2xl font-extrabold tracking-tight">Inbound transfers</h1><p className="mt-1 text-sm font-medium text-muted-foreground">Oldest first. Claiming a transfer connects you to one customer and removes it from other agents’ inboxes within a second.</p></div>
    {readOnly && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Your account is read-only. You can review transfers, but claiming a new call is disabled.</div>}
    {role !== "assistant" && data.handoffs.length > 0 && <Card><CardHeader className="border-b pb-4"><CardTitle className="text-base">Handoffs waiting for you</CardTitle></CardHeader><CardContent className="divide-y p-0">{data.handoffs.map((handoff) => <div key={handoff.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><p className="font-semibold">{handoff.customer}</p><p className="text-sm text-muted-foreground">From {handoff.bufferName} · {handoff.productLine} · verification {handoff.progressPercentage}% complete</p><p className="text-xs text-muted-foreground">Offer expires {new Date(handoff.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p></div><Button disabled={readOnly} onClick={() => void accept(handoff.id, handoff.workItemId)}>{readOnly ? "Read-only" : "Accept handoff"}</Button></div>)}</CardContent></Card>}
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-1"><Label htmlFor="inbox-status">Show</Label><select id="inbox-status" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="unclaimed">Unclaimed first</option><option value="claimed">Claimed</option><option value="all">All transfers</option></select></div>
      <div className="space-y-1"><Label htmlFor="inbox-partner">Partner</Label><select id="inbox-partner" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">All partners</option>{data.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="inbox-product">Product</Label><select id="inbox-product" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={productLine} onChange={(event) => setProductLine(event.target.value)}><option value="">All products</option>{data.products.map((product) => <option key={product} value={product}>{product}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="inbox-state">State</Label><select id="inbox-state" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={state} onChange={(event) => setState(event.target.value)}><option value="">All states</option>{data.states.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="inbox-screening">Screening</Label><select id="inbox-screening" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={screeningOutcome} onChange={(event) => setScreeningOutcome(event.target.value)}><option value="">Any result</option><option value="clear">Clear</option><option value="warning">Warning</option><option value="blocked">Blocked</option><option value="not_checked">Not checked</option></select></div>
      <div className="space-y-1"><Label htmlFor="inbox-claimed">Claimed by</Label><select id="inbox-claimed" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={claimedBy} onChange={(event) => setClaimedBy(event.target.value)}><option value="">Anyone</option><option value="me">Me</option>{data.claimedUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></div>
    </CardContent></Card>
    <Card><CardHeader className="border-b pb-4"><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base"><span>Transfer queue</span><Badge variant="outline">{data.items.length} shown</Badge></CardTitle></CardHeader><CardContent className="p-0">
      {data.items.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No transfers match these filters.</p> : <div className="divide-y">{data.items.map((item) => <div key={item.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(90px,1fr))_auto] lg:items-center">
        <div className="min-w-0"><p className="truncate font-semibold">{item.customer}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.partnerName} · {item.productLine} · {item.age === "—" ? "Age unknown" : `${item.age} years`} · {item.state}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge variant={item.screeningOutcome === "blocked" ? "destructive" : item.screeningOutcome === "warning" ? "outline" : "secondary"}>{item.screeningOutcome}</Badge>{item.preflightStatus === "already_customer" && <Badge variant="destructive">Already a customer</Badge>}{item.preflightStatus === "spoken_before" && <Badge variant="outline">Spoken before</Badge>}{item.duplicateWarning && <Badge variant="outline">Possible duplicate</Badge>}{item.screeningWarning && <span className="text-xs text-amber-700">{item.screeningWarning}</span>}</div>{item.preflightStatus !== "new_household" && <p className="mt-2 text-xs text-muted-foreground">{item.preflight?.matches?.[0]?.partnerName ? `Previous lead from ${item.preflight.matches[0].partnerName}` : "Prior contact found"}. Policy matching is not included yet.</p>}</div>
        <div><p className="text-xs text-muted-foreground">Wait</p><p className="text-sm font-medium">{waitLabel(item.waitSeconds)}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p className="text-sm font-medium capitalize">{item.status}</p></div><div><p className="text-xs text-muted-foreground">Claimed by</p><p className="truncate text-sm font-medium">{item.ownerName ?? "Nobody"}</p></div><div><p className="text-xs text-muted-foreground">Received</p><p className="text-sm">{new Date(item.queuedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p></div>
        {item.status === "unclaimed" ? <Button disabled={readOnly || claiming === item.id} onClick={() => void claim(item.id)}>{claiming === item.id ? "Connecting…" : readOnly ? "Read-only" : "Claim"}</Button> : <a className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/app/leads/${item.leadId}`}>Open lead</a>}
      </div>)}</div>}
    </CardContent></Card>
  </div>;
}
