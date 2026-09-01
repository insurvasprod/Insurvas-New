"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DispositionNode, DispositionWizard as WizardData } from "@/lib/dispositions/types";

function answerValue(step: WizardData["steps"][number]) { return step.option_key ?? (typeof step.answer === "string" ? step.answer : Array.isArray(step.answer) ? step.answer.join(", ") : "Answered"); }

export function DispositionWizard({ workItemId, readOnly }: { workItemId: string; readOnly: boolean }) {
  const [wizard, setWizard] = useState<WizardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<unknown>("");
  const [editingSequence, setEditingSequence] = useState<number | null>(null);
  const [dispositionKey, setDispositionKey] = useState("");
  const [callbackSubtype, setCallbackSubtype] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/app/inbound/disposition?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) setError(body?.error ?? "Could not load the call outcome wizard."); else { setWizard(body); setDispositionKey(body.walk.final_disposition_key ?? ""); }
    setLoading(false);
  }, [workItemId]);
  // The server walk is the resume point after a dropped call or handoff.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function beginEdit(sequence: number) {
    if (readOnly || !wizard) return;
    const step = wizard.steps.find((item) => item.sequence === sequence);
    const node = step ? wizard.flow.nodes.find((item) => item.id === step.node_id) : null;
    if (!step || !node) return;
    setEditingSequence(sequence); setAnswer(node.node_type === "multi_select" ? (Array.isArray(step.answer) ? step.answer : []) : step.option_key ?? step.answer ?? ""); setError("");
  }

  async function send(payload: Record<string, unknown>) {
    setSaving(true); setError("");
    const response = await fetch("/api/app/inbound/disposition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null); setSaving(false);
    if (!response.ok) { setError(body?.error ?? "Could not save the call outcome."); return false; }
    setWizard(body.wizard); setEditingSequence(null); setAnswer(""); if (body.wizard.walk.final_disposition_key) setDispositionKey(body.wizard.walk.final_disposition_key); return true;
  }

  async function saveAnswer(node: DispositionNode, sequence: number) {
    const payload: Record<string, unknown> = { action: "answer", work_item_id: workItemId, walk_id: wizard?.walk.id, node_id: node.id, sequence };
    if (node.node_type === "choice") payload.option_key = answer;
    else payload.answer = answer;
    await send(payload);
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading call outcome…</div>;
  if (!wizard) return <Card><CardContent className="space-y-3 p-6"><p role="alert" className="text-sm text-destructive">{error || "The call outcome wizard is unavailable."}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></CardContent></Card>;
  const node = editingSequence === null ? wizard.currentNode : wizard.flow.nodes.find((item) => item.id === wizard.steps.find((step) => step.sequence === editingSequence)?.node_id) ?? null;
  const multi = node?.node_type === "multi_select";
  const selected = Array.isArray(answer) ? answer as string[] : [];
  const completed = wizard.walk.status === "completed" && editingSequence === null;
  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/app/inbound/${workItemId}/verification`} className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" />Back to verification</Link><h1 className="mt-3 text-2xl font-extrabold tracking-tight">Call outcome</h1><p className="mt-1 text-sm text-muted-foreground">{wizard.flow.stage_name} · {wizard.workItem.productLine}</p></div>{readOnly && <Badge variant="outline">Read-only account</Badge>}</div>
    {readOnly && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Your account is read-only. You can review the call path, but cannot change its outcome.</div>}
    {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="size-4" />{error}</div>}
    <Card><CardHeader><CardTitle>{completed ? "Outcome recorded" : editingSequence !== null ? "Edit an earlier answer" : node ? node.label : "Choose the final outcome"}</CardTitle></CardHeader><CardContent className="space-y-4">
      {completed ? <div className="space-y-3"><div className="rounded-md bg-muted/40 p-4"><p className="font-semibold">{wizard.dispositions.find((item) => item.disposition_key === wizard.walk.final_disposition_key)?.label ?? wizard.walk.final_disposition_key}</p><p className="mt-1 text-sm text-muted-foreground">{wizard.walk.composed_note || "No note was composed."}</p></div><Button variant="outline" disabled={readOnly} onClick={() => beginEdit(0)}><Pencil className="size-4" />Edit an earlier answer</Button></div>
      : node ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{node.prompt}</p>{node.node_type === "choice" && <select aria-label={node.label} className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={typeof answer === "string" ? answer : ""} disabled={readOnly || saving} onChange={(event) => setAnswer(event.target.value)}><option value="">Choose an answer…</option>{node.options.map((option) => <option key={option.option_key} value={option.option_key}>{option.label}</option>)}</select>}{multi && <div className="space-y-2 rounded-md border p-3">{node.options.map((option) => <label key={option.option_key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(option.option_key)} disabled={readOnly || saving} onChange={(event) => setAnswer(event.target.checked ? [...selected, option.option_key] : selected.filter((key) => key !== option.option_key))} />{option.label}</label>)}</div>}{node.node_type === "free_text" && <textarea aria-label={node.label} className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={typeof answer === "string" ? answer : ""} disabled={readOnly || saving} onChange={(event) => setAnswer(event.target.value)} />}<Button disabled={readOnly || saving || (node.node_type === "multi_select" ? selected.length === 0 : !answer)} onClick={() => void saveAnswer(node, editingSequence ?? wizard.steps.length)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{editingSequence !== null ? "Save answer" : "Continue"}</Button></div>
      : <div className="space-y-3"><Label htmlFor="final-disposition">Final disposition</Label><select id="final-disposition" className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={dispositionKey} disabled={readOnly || saving} onChange={(event) => setDispositionKey(event.target.value)}><option value="">Choose an outcome…</option>{wizard.dispositions.map((item) => <option key={item.disposition_key} value={item.disposition_key}>{item.label}</option>)}</select><Label htmlFor="callback-detail">Optional callback detail</Label><Input id="callback-detail" value={callbackSubtype} disabled={readOnly || saving} onChange={(event) => setCallbackSubtype(event.target.value)} placeholder="Add timing or context if relevant" maxLength={120} /><Button disabled={readOnly || saving || !dispositionKey} onClick={() => void send({ action: "complete", work_item_id: workItemId, walk_id: wizard.walk.id, disposition_key: dispositionKey, callback_subtype: callbackSubtype || undefined })}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}End call</Button></div>}
    </CardContent></Card>
    {wizard.steps.length > 0 && <Card><CardHeader><CardTitle>Walked path</CardTitle></CardHeader><CardContent className="space-y-2">{wizard.steps.map((step) => <div key={step.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><p className="text-sm font-medium">{step.node_label}</p><p className="text-xs text-muted-foreground">{answerValue(step)}</p></div><Button size="sm" variant="ghost" disabled={readOnly || saving} onClick={() => beginEdit(step.sequence)}><Pencil className="size-4" />Edit</Button></div>)}</CardContent></Card>}
  </div>;
}
