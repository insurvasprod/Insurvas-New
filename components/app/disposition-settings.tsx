"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Disposition, DispositionFlow, DispositionNode, DispositionNodeType } from "@/lib/dispositions/types";

type Config = { dispositions: Disposition[]; flows: DispositionFlow[]; stages: { id: string; pipeline_id: string; name: string }[] };
type NewNode = { node_key: string; label: string; prompt: string; node_type: DispositionNodeType; note_template: string };
type NewOption = { node_id: string; option_key: string; label: string; disposition_key: string; note_template: string };

async function save(payload: unknown, method: "PATCH" | "POST" = "PATCH") {
  const response = await fetch("/api/app/dispositions/config", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not save disposition settings");
}

const blankNode: NewNode = { node_key: "", label: "", prompt: "", node_type: "choice", note_template: "" };
const blankOption: NewOption = { node_id: "", option_key: "", label: "", disposition_key: "", note_template: "" };

export function DispositionSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [flowId, setFlowId] = useState("");
  const [loading, setLoading] = useState(true);
  const [newNode, setNewNode] = useState<NewNode>(blankNode);
  const [newOption, setNewOption] = useState<NewOption>(blankOption);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/app/dispositions/config", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) toast.error(body?.error ?? "Could not load disposition settings");
    else { setConfig(body); setFlowId((current) => current || body.flows?.[0]?.id || ""); }
    setLoading(false);
  }

  // Settings are server state; hydrate once after the owner shell is mounted.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  const flow = useMemo(() => config?.flows.find((item) => item.id === flowId) ?? null, [config, flowId]);
  const nodes = flow?.nodes ?? [];

  async function updateDisposition(item: Disposition, patch: Partial<Disposition>) {
    try {
      await save({ kind: "disposition", id: item.id, label: patch.label ?? item.label, counts_as_work_completed: patch.counts_as_work_completed ?? item.counts_as_work_completed, closes_as: patch.closes_as ?? item.closes_as, is_active: patch.is_active ?? item.is_active });
      setConfig((current) => current && { ...current, dispositions: current.dispositions.map((row) => row.id === item.id ? { ...row, ...patch } : row) });
      toast.success("Disposition saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save disposition"); }
  }

  async function updateNode(node: DispositionNode, patch: Partial<DispositionNode>) {
    try {
      await fetchPatch({ kind: "node", id: node.id, label: patch.label ?? node.label, prompt: patch.prompt ?? node.prompt, node_type: patch.node_type ?? node.node_type, note_template: patch.note_template !== undefined ? patch.note_template : node.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : node.next_node_id });
      toast.success("Question saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save question"); }
  }

  async function updateOption(option: DispositionNode["options"][number], patch: { label?: string; disposition_key?: string | null; note_template?: string | null; next_node_id?: string | null }) {
    try {
      await fetchPatch({ kind: "option", id: option.id, label: patch.label ?? option.label, disposition_key: patch.disposition_key !== undefined ? patch.disposition_key : option.disposition_key, note_template: patch.note_template !== undefined ? patch.note_template : option.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : option.next_node_id });
      toast.success("Answer saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save answer"); }
  }

  async function fetchPatch(payload: unknown) { await save(payload); await load(); }

  async function createNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flowId) return;
    try { await save({ flow_id: flowId, ...newNode, note_template: newNode.note_template || null }, "POST"); setNewNode(blankNode); await load(); toast.success("Question added"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not add question"); }
  }

  async function createOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOption.node_id) return;
    try { await save({ ...newOption, note_template: newOption.note_template || null, disposition_key: newOption.disposition_key || null }, "POST"); setNewOption(blankOption); await load(); toast.success("Answer added"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not add answer"); }
  }

  if (loading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading disposition settings…</CardContent></Card>;
  if (!config) return null;
  return <Card><CardHeader><CardTitle className="text-base">Call outcomes & disposition wizard</CardTitle><p className="text-sm text-muted-foreground">Keep one tenant vocabulary for every call. Edit labels, work-completed behavior, note prompts, and the graph used by the wizard.</p></CardHeader><CardContent className="space-y-6">
    <div className="space-y-3"><h3 className="font-semibold">Outcome vocabulary</h3>{config.dispositions.map((item) => <div key={item.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_150px_150px_auto] sm:items-end"><div className="space-y-1"><Label htmlFor={`disposition-${item.id}`}>{item.disposition_key}</Label><Input id={`disposition-${item.id}`} defaultValue={item.label} maxLength={120} onBlur={(event) => { if (event.target.value !== item.label) void updateDisposition(item, { label: event.target.value }); }} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={item.counts_as_work_completed} onChange={(event) => void updateDisposition(item, { counts_as_work_completed: event.target.checked })} />Counts as work</label><div className="space-y-1"><Label htmlFor={`close-${item.id}`}>Closes as</Label><select id={`close-${item.id}`} className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={item.closes_as} onChange={(event) => void updateDisposition(item, { closes_as: event.target.value as Disposition["closes_as"] })}><option value="completed">Completed</option><option value="dropped">Dropped</option></select></div><span className="text-xs text-muted-foreground">{item.is_active ? "Active" : "Inactive"}</span></div>)}</div>
    <div className="space-y-3"><h3 className="font-semibold">Wizard templates by stage</h3><select aria-label="Disposition flow" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={flowId} onChange={(event) => { setFlowId(event.target.value); setNewOption((current) => ({ ...current, node_id: "" })); }}>{config.flows.map((item) => <option key={item.id} value={item.id}>{item.stage_name} · {item.name}</option>)}</select>{flow && <form className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-2" onSubmit={(event) => void createNode(event)}><p className="text-sm font-semibold sm:col-span-2">Add question</p><div className="space-y-1"><Label htmlFor="new-node-key">Question key</Label><Input id="new-node-key" required pattern="[a-z][a-z0-9_]{1,79}" value={newNode.node_key} onChange={(event) => setNewNode({ ...newNode, node_key: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-node-label">Question label</Label><Input id="new-node-label" required maxLength={160} value={newNode.label} onChange={(event) => setNewNode({ ...newNode, label: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-node-prompt">Prompt</Label><Input id="new-node-prompt" required maxLength={2000} value={newNode.prompt} onChange={(event) => setNewNode({ ...newNode, prompt: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-node-type">Question type</Label><select id="new-node-type" className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={newNode.node_type} onChange={(event) => setNewNode({ ...newNode, node_type: event.target.value as DispositionNodeType })}><option value="choice">Choice</option><option value="multi_select">Multiple choice</option><option value="free_text">Free text</option></select></div><Button type="submit" className="sm:col-span-2">Add question</Button></form>}
    {flow?.nodes.map((node) => <div key={node.id} className="space-y-3 rounded-md border p-3"><div className="grid gap-3 sm:grid-cols-[1fr_1fr_150px_190px]"><div className="space-y-1"><Label htmlFor={`node-label-${node.id}`}>Question label</Label><Input id={`node-label-${node.id}`} defaultValue={node.label} maxLength={160} onBlur={(event) => void updateNode(node, { label: event.target.value })} /></div><div className="space-y-1"><Label htmlFor={`node-prompt-${node.id}`}>Prompt</Label><Input id={`node-prompt-${node.id}`} defaultValue={node.prompt} maxLength={2000} onBlur={(event) => void updateNode(node, { prompt: event.target.value })} /></div><div className="space-y-1"><Label htmlFor={`node-type-${node.id}`}>Question type</Label><select id={`node-type-${node.id}`} className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={node.node_type} onChange={(event) => void updateNode(node, { node_type: event.target.value as DispositionNodeType })}><option value="choice">Choice</option><option value="multi_select">Multiple choice</option><option value="free_text">Free text</option></select></div><div className="space-y-1"><Label htmlFor={`node-next-${node.id}`}>Next question</Label><select id={`node-next-${node.id}`} className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={node.next_node_id ?? ""} onChange={(event) => void updateNode(node, { next_node_id: event.target.value || null })}><option value="">Ends here</option>{nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></div></div><div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Answers</p>{node.options.map((option) => <div key={option.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr] sm:items-end"><div className="space-y-1"><Label htmlFor={`option-label-${option.id}`}>Label</Label><Input id={`option-label-${option.id}`} defaultValue={option.label} maxLength={160} onBlur={(event) => void updateOption(option, { label: event.target.value })} /></div><div className="space-y-1"><Label htmlFor={`option-key-${option.id}`}>Terminal outcome key</Label><Input id={`option-key-${option.id}`} defaultValue={option.disposition_key ?? ""} maxLength={80} onBlur={(event) => void updateOption(option, { disposition_key: event.target.value || null })} /></div><div className="space-y-1"><Label htmlFor={`option-next-${option.id}`}>Next question</Label><select id={`option-next-${option.id}`} className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={option.next_node_id ?? ""} onChange={(event) => void updateOption(option, { next_node_id: event.target.value || null })}><option value="">Ends call</option>{nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></div><div className="space-y-1"><Label htmlFor={`option-note-${option.id}`}>Note template</Label><Input id={`option-note-${option.id}`} defaultValue={option.note_template ?? ""} maxLength={2000} onBlur={(event) => void updateOption(option, { note_template: event.target.value || null })} /></div></div>)}</div></div>)}
    {flow && <form className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-2" onSubmit={(event) => void createOption(event)}><p className="text-sm font-semibold sm:col-span-2">Add answer</p><div className="space-y-1 sm:col-span-2"><Label htmlFor="new-option-node">Question</Label><select id="new-option-node" required className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm" value={newOption.node_id} onChange={(event) => setNewOption({ ...newOption, node_id: event.target.value })}><option value="">Choose a question…</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></div><div className="space-y-1"><Label htmlFor="new-option-key">Answer key</Label><Input id="new-option-key" required pattern="[a-z][a-z0-9_]{1,79}" value={newOption.option_key} onChange={(event) => setNewOption({ ...newOption, option_key: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-option-label">Answer label</Label><Input id="new-option-label" required maxLength={160} value={newOption.label} onChange={(event) => setNewOption({ ...newOption, label: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-option-disposition">Terminal outcome key</Label><Input id="new-option-disposition" maxLength={80} value={newOption.disposition_key} onChange={(event) => setNewOption({ ...newOption, disposition_key: event.target.value })} /></div><div className="space-y-1"><Label htmlFor="new-option-note">Note template</Label><Input id="new-option-note" maxLength={2000} value={newOption.note_template} onChange={(event) => setNewOption({ ...newOption, note_template: event.target.value })} /></div><Button type="submit" className="sm:col-span-2">Add answer</Button></form>}
    </div>
  </CardContent></Card>;
}
