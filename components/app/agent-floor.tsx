"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Clock3, Loader2, Phone, Radio, ShieldAlert, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { toast } from "sonner";

type Lead = {
  id: string; leadId: string; customer: string; age: string; state: string; partnerName: string;
  productLine: string; screeningOutcome: string; screeningWarning: string | null; duplicateWarning: boolean;
  queuedAt: string; ownerName: string | null;
};
type Call = Lead & { activeCallId: string; agentId: string; agentName: string; agentRole: string; startedAt: string };
type Member = { id: string; name: string; role: string; availability: "ready" | "on_break" | "off" | "offline" | "on_call"; lastSeenAt: string | null };
type Handoff = { id: string; workItemId: string; bufferName: string; customer: string; productLine: string; progressPercentage: number; expiresAt: string };
type FloorData = { waiting: Lead[]; onCalls: Call[]; available: Member[]; members: Member[]; pendingHandoffs: Handoff[]; realtimeTopic: string; generatedAt: string; waitThresholds: { amberSeconds: number; redSeconds: number } };

function durationSince(value: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function screeningBadge(item: Lead) {
  if (item.duplicateWarning) return <Badge variant="destructive"><ShieldAlert className="size-3" />Duplicate warning</Badge>;
  if (item.screeningWarning) return <Badge variant="outline" className="border-amber-500/50 text-amber-700"><ShieldAlert className="size-3" />Review screening</Badge>;
  return <Badge variant="secondary"><CheckCircle2 className="size-3" />{item.screeningOutcome || "Screened"}</Badge>;
}

function waitTone(queuedAt: string, now: number, thresholds: FloorData["waitThresholds"]) {
  const seconds = Math.max(0, Math.floor((now - new Date(queuedAt).getTime()) / 1000));
  return seconds >= thresholds.redSeconds ? "border-red-500/60 bg-red-500/5" : seconds >= thresholds.amberSeconds ? "border-amber-500/60 bg-amber-500/5" : "border-border";
}

function thresholdLabel(seconds: number) {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function effectiveAvailability(member: Member, now: number): Member["availability"] {
  if (member.availability === "on_call") return "on_call";
  if (!member.lastSeenAt || now - new Date(member.lastSeenAt).getTime() > 60_000) return "offline";
  return member.availability;
}

function LeadCard({ item, now, thresholds, readOnly, onClaim, onNudge, saving }: { item: Lead; now: number; thresholds: FloorData["waitThresholds"]; readOnly: boolean; onClaim: (id: string) => void; onNudge: (id: string) => void; saving: string | null }) {
  return <Card className={`gap-3 ${waitTone(item.queuedAt, now, thresholds)}`}>
    <CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{item.customer}</p><p className="text-sm text-muted-foreground">{item.age} · {item.state} · {item.productLine}</p></div>
        <span className="flex items-center gap-1 font-mono text-sm tabular-nums"><Clock3 className="size-4" />{durationSince(item.queuedAt, now)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>From {item.partnerName}</span>{screeningBadge(item)}</div>
      {item.screeningWarning && <p className="text-xs text-amber-700">{item.screeningWarning}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={readOnly || saving === item.id} onClick={() => onClaim(item.id)}>{saving === item.id ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}Claim</Button>
        <Button size="sm" variant="outline" disabled={readOnly || saving === `nudge:${item.id}`} onClick={() => onNudge(item.id)}>{saving === `nudge:${item.id}` ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}Nudge team</Button>
        <Button size="sm" variant="ghost" asChild><Link href={`/app/inbound/${item.id}/verification`}>Open lead</Link></Button>
      </div>
    </CardContent>
  </Card>;
}

export function AgentFloor({ currentUserId, readOnly }: { currentUserId: string; readOnly: boolean }) {
  const [floor, setFloor] = useState<FloorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState<string | null>(null);
  const [availability, setAvailability] = useState<"ready" | "on_break" | "off">("ready");
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [targetUserId, setTargetUserId] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/app/agent-floor", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load the Agent Floor."); setLoading(false); return; }
    setFloor(body); setError(""); setLoading(false);
  }, []);

  // The initial request is the server-backed floor snapshot; subsequent refreshes come only from
  // the Realtime callback below, never from a data-polling interval.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!floor?.realtimeTopic) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { queueMicrotask(() => setRealtimeStatus("unconfigured")); return; }
    const channel = supabase.channel(floor.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, () => { void load(); })
      .subscribe((status) => setRealtimeStatus(status.toLowerCase()));
    return () => { void supabase.removeChannel(channel); };
  }, [floor?.realtimeTopic, load]);
  useEffect(() => {
    if (readOnly) return;
    const sendHeartbeat = () => fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presence", status: availability }) }).catch(() => undefined);
    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [availability, readOnly]);

  const visibleMembers = useMemo(
    () => (floor?.members ?? []).map((member) => ({ ...member, availability: effectiveAvailability(member, now) })),
    [floor?.members, now],
  );
  const availableMembers = useMemo(
    () => visibleMembers.filter((member) => member.availability !== "on_call"),
    [visibleMembers],
  );
  const readyTargets = useMemo(() => availableMembers.filter((member) => member.id !== currentUserId && member.availability === "ready"), [availableMembers, currentUserId]);
  const selectedTargetUserId = readyTargets.some((member) => member.id === targetUserId) ? targetUserId : "";

  async function claim(workItemId: string) {
    setSaving(workItemId);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { toast.error(body?.error ?? "Could not claim this transfer."); return; }
    toast.success("Transfer claimed");
    await load();
  }

  async function nudge(workItemId: string) {
    setSaving(`nudge:${workItemId}`);
    const response = await fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: workItemId, target_user_id: selectedTargetUserId || null, idempotency_key: crypto.randomUUID() }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { toast.error(body?.error ?? "Could not send the nudge."); return; }
    toast.success(body.nudge?.alreadySent ? "That nudge was already sent" : "Nudge sent");
  }

  async function accept(handoffId: string) {
    setSaving(`handoff:${handoffId}`);
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { toast.error(body?.error ?? "Could not accept this handoff."); return; }
    toast.success("Handoff accepted");
    await load();
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading Agent Floor…</div>;
  if (!floor) return <Card><CardContent className="space-y-3 p-6"><p role="alert" className="text-sm text-destructive">{error || "The Agent Floor is unavailable."}</p><Button variant="outline" onClick={() => { setLoading(true); void load(); }}>Try again</Button></CardContent></Card>;

  return <div className="mx-auto max-w-[1500px] space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Inbound operations</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Agent Floor</h1><p className="mt-2 text-sm text-muted-foreground">One live view of the transfers waiting, calls in progress, and your team.</p></div><div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Radio className="size-4" />Realtime {realtimeStatus}</div><div className="flex items-center gap-2"><Label htmlFor="floor-availability" className="text-sm">I am</Label><select id="floor-availability" aria-label="My availability" disabled={readOnly} value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)} className="border-input bg-background h-9 rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"><option value="ready">Ready</option><option value="on_break">On break</option><option value="off">Off</option></select></div></div></div>
    {readOnly && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">This account is suspended and read-only. You can still review your own inbound data, but cannot claim, nudge, hand off, or change availability.</div>}
    {realtimeStatus === "unconfigured" && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Live updates are not configured in this browser. The floor data is protected, but another deployment key is needed for realtime refresh.</div>}
    <section aria-labelledby="waiting-heading" className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 id="waiting-heading" className="text-lg font-bold">Waiting <span className="text-muted-foreground">{floor.waiting.length}</span></h2><p className="text-xs text-muted-foreground">Amber after {thresholdLabel(floor.waitThresholds.amberSeconds)} · red after {thresholdLabel(floor.waitThresholds.redSeconds)}</p></div>{floor.waiting.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No transfers are waiting. New qualified inbound calls will appear here automatically.</CardContent></Card> : <div className="grid gap-3 xl:grid-cols-2">{floor.waiting.map((item) => <LeadCard key={item.id} item={item} now={now} thresholds={floor.waitThresholds} readOnly={readOnly} onClaim={(id) => void claim(id)} onNudge={(id) => void nudge(id)} saving={saving} />)}</div>}</section>
    <section aria-labelledby="calls-heading" className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 id="calls-heading" className="text-lg font-bold">On calls <span className="text-muted-foreground">{floor.onCalls.length}</span></h2><p className="text-xs text-muted-foreground">Only open active calls appear here</p></div>{floor.onCalls.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No live calls right now.</CardContent></Card> : <div className="grid gap-3 xl:grid-cols-2">{floor.onCalls.map((item) => <Card key={item.activeCallId}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.customer}</p><p className="text-sm text-muted-foreground">{item.age} · {item.state} · {item.productLine}</p></div><span className="flex items-center gap-1 font-mono text-sm tabular-nums"><Phone className="size-4" />{durationSince(item.startedAt, now)}</span></div><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1"><UserRound className="size-3" />{item.agentName} · {item.agentRole}</span>{screeningBadge(item)}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link href={`/app/inbound/${item.id}/verification`}>Verification</Link></Button>{item.agentId === currentUserId && <Button size="sm" variant="ghost" asChild><Link href={`/app/inbound/${item.id}/disposition`}>Close with disposition</Link></Button>}</div></CardContent></Card>)}</div>}</section>
    <section aria-labelledby="available-heading" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="available-heading" className="text-lg font-bold">Available <span className="text-muted-foreground">{availableMembers.length}</span></h2><div className="flex items-center gap-2"><Label htmlFor="nudge-target" className="text-xs text-muted-foreground">Nudge target</Label><select id="nudge-target" aria-label="Nudge target" value={selectedTargetUserId} onChange={(event) => setTargetUserId(event.target.value)} className="border-input bg-background h-8 rounded-md border px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"><option value="">Whole team</option>{readyTargets.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div></div>{availableMembers.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No other team members are currently available. The floor will update when presence changes.</CardContent></Card> : <Card><CardContent className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">{availableMembers.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.role}</p></div><Badge variant={member.availability === "ready" ? "secondary" : "outline"}>{member.availability.replace("_", " ")}</Badge></div>)}</CardContent></Card>}</section>
    {floor.pendingHandoffs.length > 0 && <section aria-labelledby="handoffs-heading" className="space-y-3"><h2 id="handoffs-heading" className="text-lg font-bold">Handoffs for me <span className="text-muted-foreground">{floor.pendingHandoffs.length}</span></h2><div className="grid gap-3 xl:grid-cols-2">{floor.pendingHandoffs.map((handoff) => <Card key={handoff.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{handoff.customer}</p><p className="text-sm text-muted-foreground">From {handoff.bufferName} · {handoff.productLine} · {handoff.progressPercentage}% verified</p></div><Button size="sm" disabled={readOnly || saving === `handoff:${handoff.id}`} onClick={() => void accept(handoff.id)}>{saving === `handoff:${handoff.id}` ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Accept handoff</Button></CardContent></Card>)}</div></section>}
  </div>;
}
