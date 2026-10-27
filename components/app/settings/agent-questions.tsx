"use client";

/**
 * The questions an agent answers before choosing an outcome — each stage's wizard (LA-1.12), moved
 * here from Settings › Dispositions when it merged into Pipelines & outcomes (2026-10-27). Opened from a
 * stage's editor. Edits save as they are made, as they always have: a half-saved question graph is what
 * the wizard would walk, so it is never part of the page's draft.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { Callout, Field, control } from "@/components/app/settings/primitives";
import type { DispositionFlow, DispositionNode, DispositionNodeType, DispositionOption, DispositionSettingsRow } from "@/lib/dispositions/types";

type Config = { dispositions: DispositionSettingsRow[]; flows: DispositionFlow[] };
type NewNode = { node_key: string; label: string; prompt: string; node_type: DispositionNodeType; note_template: string };
type NewOption = { node_id: string; option_key: string; label: string; disposition_key: string; note_template: string };

const NODE_TYPE_LABELS: Record<DispositionNodeType, string> = { choice: "Choice", multi_select: "Multiple choice", free_text: "Free text" };
const blankNode: NewNode = { node_key: "", label: "", prompt: "", node_type: "choice", note_template: "" };
const blankOption: NewOption = { node_id: "", option_key: "", label: "", disposition_key: "", note_template: "" };

async function send(payload: unknown, method: "PATCH" | "POST") {
  const response = await fetch("/api/app/dispositions/config", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not save the question");
  return body;
}

function OutcomeKeySelect({ id, value, outcomes, onChange }: { id: string; value: string; outcomes: DispositionSettingsRow[]; onChange: (value: string) => void }) {
  const known = outcomes.some((item) => item.disposition_key === value);
  return (
    <select id={id} className={control} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">None</option>
      {!known && value && <option value={value}>{value} (not an outcome)</option>}
      {outcomes.map((item) => <option key={item.id} value={item.disposition_key}>{item.label}{item.is_active ? "" : " (archived)"}</option>)}
    </select>
  );
}

export function AgentQuestionsDialog({ stageId, stageName, onClose }: { stageId: string; stageName: string; onClose: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [newNode, setNewNode] = useState<NewNode>(blankNode);
  const [newOption, setNewOption] = useState<NewOption>(blankOption);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/dispositions/config", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load the questions"); return; }
    setConfig(body as Config);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog's own data, loaded when it opens
  useEffect(() => { void load(); }, [load]);

  const flow = config?.flows.find((item) => item.stage_id === stageId) ?? null;
  const nodes = flow?.nodes ?? [];

  async function saveAndReload(payload: unknown, done: string, method: "PATCH" | "POST" = "PATCH") {
    try { await send(payload, method); await load(); notify.done(done); return true; }
    catch (failure) { notify.fail(failure instanceof Error ? failure.message : "Could not save"); return false; }
  }
  function updateNode(node: DispositionNode, patch: Partial<DispositionNode>) {
    void saveAndReload({ kind: "node", id: node.id, label: patch.label ?? node.label, prompt: patch.prompt ?? node.prompt, node_type: patch.node_type ?? node.node_type, note_template: patch.note_template !== undefined ? patch.note_template : node.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : node.next_node_id }, "Question saved");
  }
  function updateOption(option: DispositionOption, patch: { label?: string; disposition_key?: string | null; note_template?: string | null; next_node_id?: string | null }) {
    void saveAndReload({ kind: "option", id: option.id, label: patch.label ?? option.label, disposition_key: patch.disposition_key !== undefined ? patch.disposition_key : option.disposition_key, note_template: patch.note_template !== undefined ? patch.note_template : option.note_template, next_node_id: patch.next_node_id !== undefined ? patch.next_node_id : option.next_node_id }, "Answer saved");
  }
  async function createNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flow) return;
    if (await saveAndReload({ kind: "node", flow_id: flow.id, ...newNode, note_template: newNode.note_template || null }, "Question added", "POST")) setNewNode(blankNode);
  }
  async function createOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOption.node_id) return;
    if (await saveAndReload({ kind: "option", ...newOption, note_template: newOption.note_template || null, disposition_key: newOption.disposition_key || null }, "Answer added", "POST")) setNewOption(blankOption);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] sm:max-w-3xl">
        <DialogHeader><DialogTitle className="text-[var(--ink)]">Questions the agent answers · {stageName}</DialogTitle></DialogHeader>
        <p className="m-0 text-sm text-[var(--muted)]">Shown on a lead in this stage before the agent picks an outcome. Each change saves as you make it.</p>
        {error && <Callout tone="error" title={error} />}
        {!config && !error && <SectionLoading label="Loading the questions" />}
        {config && !flow && <Callout tone="info" title="This stage has no questions yet." />}

        {nodes.map((node) => (
          <section key={node.id} className="rounded-[12px] border border-[var(--border)] p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Question" htmlFor={`node-label-${node.id}`}>
                <input id={`node-label-${node.id}`} className={control} defaultValue={node.label} maxLength={160} onBlur={(event) => { if (event.target.value !== node.label) updateNode(node, { label: event.target.value }); }} />
              </Field>
              <Field label="Prompt" htmlFor={`node-prompt-${node.id}`}>
                <input id={`node-prompt-${node.id}`} className={control} defaultValue={node.prompt} maxLength={2000} onBlur={(event) => { if (event.target.value !== node.prompt) updateNode(node, { prompt: event.target.value }); }} />
              </Field>
              <Field label="Question type" htmlFor={`node-type-${node.id}`}>
                <select id={`node-type-${node.id}`} className={control} value={node.node_type} onChange={(event) => updateNode(node, { node_type: event.target.value as DispositionNodeType })}>
                  {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Next question" htmlFor={`node-next-${node.id}`} hint="Used by free-text and multiple-choice questions.">
                <select id={`node-next-${node.id}`} className={control} value={node.next_node_id ?? ""} onChange={(event) => updateNode(node, { next_node_id: event.target.value || null })}>
                  <option value="">Ends here</option>
                  {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <span className="text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">Answers</span>
              {node.options.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">No answers yet.</p>}
              {node.options.map((option) => (
                <div key={option.id} className="grid gap-3 rounded-[8px] bg-[var(--surface-alt)] p-3 sm:grid-cols-4">
                  <Field label="Label" htmlFor={`option-label-${option.id}`}>
                    <input id={`option-label-${option.id}`} className={control} defaultValue={option.label} maxLength={160} onBlur={(event) => { if (event.target.value !== option.label) updateOption(option, { label: event.target.value }); }} />
                  </Field>
                  <Field label="Ends with outcome" htmlFor={`option-key-${option.id}`}>
                    <OutcomeKeySelect id={`option-key-${option.id}`} value={option.disposition_key ?? ""} outcomes={config?.dispositions ?? []} onChange={(value) => updateOption(option, { disposition_key: value || null })} />
                  </Field>
                  <Field label="Next question" htmlFor={`option-next-${option.id}`}>
                    <select id={`option-next-${option.id}`} className={control} value={option.next_node_id ?? ""} onChange={(event) => updateOption(option, { next_node_id: event.target.value || null })}>
                      <option value="">Ends call</option>
                      {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Note template" htmlFor={`option-note-${option.id}`}>
                    <input id={`option-note-${option.id}`} className={control} defaultValue={option.note_template ?? ""} maxLength={2000} onBlur={(event) => { if (event.target.value !== (option.note_template ?? "")) updateOption(option, { note_template: event.target.value || null }); }} />
                  </Field>
                </div>
              ))}
            </div>
          </section>
        ))}

        {flow && (
          <form className="grid gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] p-4 sm:grid-cols-2" onSubmit={(event) => void createNode(event)}>
            <span className="text-sm font-semibold text-[var(--ink)] sm:col-span-2">Add a question</span>
            <Field label="Question key" htmlFor="new-node-key">
              <input id="new-node-key" className={control} required pattern="[a-z][a-z0-9_]{1,79}" value={newNode.node_key} onChange={(event) => setNewNode({ ...newNode, node_key: event.target.value })} />
            </Field>
            <Field label="Question" htmlFor="new-node-label">
              <input id="new-node-label" className={control} required maxLength={160} value={newNode.label} onChange={(event) => setNewNode({ ...newNode, label: event.target.value })} />
            </Field>
            <Field label="Prompt" htmlFor="new-node-prompt">
              <input id="new-node-prompt" className={control} required maxLength={2000} value={newNode.prompt} onChange={(event) => setNewNode({ ...newNode, prompt: event.target.value })} />
            </Field>
            <Field label="Question type" htmlFor="new-node-type">
              <select id="new-node-type" className={control} value={newNode.node_type} onChange={(event) => setNewNode({ ...newNode, node_type: event.target.value as DispositionNodeType })}>
                {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Button type="submit" variant="outline" className="justify-self-start sm:col-span-2">Add question</Button>
          </form>
        )}

        {flow && nodes.length > 0 && (
          <form className="grid gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] p-4 sm:grid-cols-2" onSubmit={(event) => void createOption(event)}>
            <span className="text-sm font-semibold text-[var(--ink)] sm:col-span-2">Add an answer</span>
            <Field label="Question" htmlFor="new-option-node" className="sm:col-span-2">
              <select id="new-option-node" className={control} required value={newOption.node_id} onChange={(event) => setNewOption({ ...newOption, node_id: event.target.value })}>
                <option value="">Choose a question…</option>
                {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
            </Field>
            <Field label="Answer key" htmlFor="new-option-key">
              <input id="new-option-key" className={control} required pattern="[a-z][a-z0-9_]{1,79}" value={newOption.option_key} onChange={(event) => setNewOption({ ...newOption, option_key: event.target.value })} />
            </Field>
            <Field label="Answer" htmlFor="new-option-label">
              <input id="new-option-label" className={control} required maxLength={160} value={newOption.label} onChange={(event) => setNewOption({ ...newOption, label: event.target.value })} />
            </Field>
            <Field label="Ends with outcome" htmlFor="new-option-disposition">
              <OutcomeKeySelect id="new-option-disposition" value={newOption.disposition_key} outcomes={config?.dispositions ?? []} onChange={(value) => setNewOption({ ...newOption, disposition_key: value })} />
            </Field>
            <Field label="Note template" htmlFor="new-option-note">
              <input id="new-option-note" className={control} maxLength={2000} value={newOption.note_template} onChange={(event) => setNewOption({ ...newOption, note_template: event.target.value })} />
            </Field>
            <Button type="submit" variant="outline" className="justify-self-start sm:col-span-2">Add answer</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
