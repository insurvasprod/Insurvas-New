"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, CircleAlert, Clock3, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CallbackView } from "@/lib/callbacks/service";

function customerLocalInput(callback: CallbackView) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: callback.customerTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(callback.scheduledAtUtc));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour === "24" ? "00" : values.hour}:${values.minute}`;
}

function agentLocalTime(callback: CallbackView) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(callback.scheduledAtUtc));
}

export function CallbackCalendar({ readOnly }: { readOnly: boolean }) {
  const [callbacks, setCallbacks] = useState<CallbackView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reschedule, setReschedule] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch("/api/app/callbacks", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error ?? "Could not load callbacks."); else setCallbacks(body.callbacks ?? []);
    setLoading(false);
  }, []);
  // The calendar is a client-side snapshot of the server API and must load on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const due = useMemo(() => callbacks.filter((item) => item.isDueToday && !["completed", "cancelled"].includes(item.status)), [callbacks]);
  const overdue = useMemo(() => callbacks.filter((item) => item.isOverdue && !["completed", "cancelled"].includes(item.status)), [callbacks]);
  async function action(callback: CallbackView, actionName: "reschedule" | "cancel" | "complete") {
    setSaving(callback.id); setError("");
    const response = await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, callback_id: callback.id, callback_local: actionName === "reschedule" ? reschedule[callback.id] : undefined }) });
    const body = await response.json().catch(() => null); setSaving(null);
    if (!response.ok) { setError(body?.error ?? "Could not update callback. Your changes were kept on screen."); return; }
    await load();
  }
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading callbacks…</div>;
  return <div className="mx-auto max-w-6xl space-y-6">
    <div><p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sell</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Callback calendar</h1><p className="mt-2 text-sm text-muted-foreground">Times are shown in the customer’s timezone, with your local time alongside.</p></div>
    {readOnly && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">This account is suspended and read-only. You can still review callbacks.</div>}
    {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="size-4" />{error}</div>}
    <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Due today</p><p className="mt-1 text-2xl font-bold">{due.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Overdue</p><p className="mt-1 text-2xl font-bold text-destructive">{overdue.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Open callbacks</p><p className="mt-1 text-2xl font-bold">{callbacks.filter((item) => !["completed", "cancelled"].includes(item.status)).length}</p></CardContent></Card></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-5" />Upcoming and open callbacks</CardTitle></CardHeader><CardContent className="space-y-3">{callbacks.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No callbacks scheduled.</p> : callbacks.map((callback) => <div key={callback.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{callback.customerName}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />Customer: {callback.customerTime} ({callback.customerTimezone}) · You: {agentLocalTime(callback)}</p><p className="mt-1 text-xs text-muted-foreground">Assigned to {callback.assigneeName} · {callback.note || "No note"}</p></div><Badge variant={callback.isOverdue ? "destructive" : callback.isDueToday ? "secondary" : "outline"}>{callback.isOverdue ? "Overdue" : callback.isDueToday ? "Due today" : callback.status}</Badge></div>{!readOnly && !["completed", "cancelled"].includes(callback.status) && <div className="mt-3 flex flex-wrap items-end gap-2"><div><label htmlFor={`reschedule-${callback.id}`} className="mb-1 block text-xs font-medium">New customer-local time</label><Input id={`reschedule-${callback.id}`} type="datetime-local" value={reschedule[callback.id] ?? customerLocalInput(callback)} onChange={(event) => setReschedule((current) => ({ ...current, [callback.id]: event.target.value }))} /></div><Button variant="outline" disabled={saving === callback.id} onClick={() => void action(callback, "reschedule")}>{saving === callback.id ? <Loader2 className="size-4 animate-spin" /> : <Clock3 className="size-4" />}Reschedule</Button><Button variant="outline" disabled={saving === callback.id} onClick={() => void action(callback, "complete")}><Check className="size-4" />Complete</Button><Button variant="ghost" disabled={saving === callback.id} onClick={() => void action(callback, "cancel")}><X className="size-4" />Cancel</Button></div>}{callback.history.length > 1 && <p className="mt-3 text-xs text-muted-foreground">{callback.history.length} timeline records · <Link className="underline" href={`/app/leads/${callback.leadId}`}>Open lead</Link></p>}</div>)}</CardContent></Card>
  </div>;
}
