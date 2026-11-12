"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, inputControl } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { NONE } from "@/lib/ingestion/policyBook";
import type { MappedAgent, UnmappedAgent } from "@/lib/ingestion/policyMatchingStore";
import { cn } from "@/lib/utils";

/**
 * Setup › Agent codes, direction A (docs/la4/mockups-r7/carrier-sync-setup.html, board 3·1): every edit of a code
 * is one md dialog with its consequence said beside the choice; the list stays as it was behind. The dialogs only
 * draw and collect; agent-codes.tsx makes the calls (map_agent, unmap_agent, add_agent) and says what happened.
 * An error the person can fix stays in the dialog, on its error line (UI-CONSISTENCY §11), never a toast.
 */

export type Member = { userId: string; name: string };
export type Carrier = { id: string; name: string };
/** A call's outcome: null when it saved, else the line to show. */
export type Outcome = string | null;

/** The policies a code credits, on Policies: its carrier, and its person (or "No agent mapped"). */
export function policiesHref(carrierId: string, userId: string | null): string {
  return `/app/policies?${new URLSearchParams({ carrier: carrierId, agent: userId ?? NONE }).toString()}`;
}

export const policiesLabel = (count: number) => `${count.toLocaleString("en-US")} ${count === 1 ? "policy" : "policies"}`;

const memberOptions = (members: Member[]) => [{ value: "", label: "Choose the person" }, ...members.map((m) => ({ value: m.userId, label: m.name }))];

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>;
}

function PersonField({ id, value, members, disabled, hint, onChange }: { id: string; value: string; members: Member[]; disabled: boolean; hint?: string; onChange: (value: string) => void }) {
  return (
    <Field label="Person" htmlFor={id} hint={hint}>
      <SelectMenu id={id} label="Person" className="mt-1.5 w-full" matchTriggerWidth searchPlaceholder="Search people" disabled={disabled} value={value} options={memberOptions(members)} onChange={onChange} />
    </Field>
  );
}

/**
 * Map a code nobody is mapped to. Opened from its row it maps that one code; opened by "Map one by one" it walks
 * `queue` (biggest first, as handed in), saying "1 of 3", with Skip and Map and next.
 */
export function MapCodeDialog({ queue, stepping, members, readOnly, onMap, onClose }: {
  queue: UnmappedAgent[];
  stepping: boolean;
  members: Member[];
  readOnly: boolean;
  onMap: (agent: UnmappedAgent, userId: string) => Promise<Outcome>;
  onClose: () => void;
}) {
  const [at, setAt] = useState(0);
  const [person, setPerson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agent = queue[at];
  if (!agent) return null;
  const last = at >= queue.length - 1;
  const next = () => {
    if (last) { onClose(); return; }
    setAt(at + 1);
    setPerson("");
    setError(null);
  };
  const map = async (andNext: boolean) => {
    setBusy(true);
    setError(null);
    const failed = await onMap(agent, person);
    setBusy(false);
    if (failed) { setError(failed); return; }
    if (andNext) next();
    else onClose();
  };
  const person0 = members.find((m) => m.userId === person);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <div className="flex items-baseline gap-3 pr-8">
            <DialogTitle className="font-mono">{`Map ${agent.agentIdentifier}`}</DialogTitle>
            {stepping && queue.length > 1 && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{`${at + 1} of ${queue.length}`}</span>}
          </div>
          <DialogDescription>
            {agent.carrierName} · <Link href={policiesHref(agent.carrierId, null)} className="font-medium text-foreground underline underline-offset-2">{policiesLabel(agent.policies)}</Link> {agent.policies === 1 ? "waits" : "wait"} for a person: no producer gets the credit, and their commissions can&apos;t be split.
          </DialogDescription>
        </DialogHeader>
        {readOnly ? (
          <p className="m-0 text-sm text-muted-foreground">Nobody is mapped to this code. Mapping is paused while the account is read-only.</p>
        ) : (
          <div className="grid gap-3">
            <PersonField id="agent-code-map-person" value={person} members={members} disabled={busy} onChange={(value) => { setPerson(value); setError(null); }} />
            <ErrorLine error={error} />
          </div>
        )}
        <DialogFooter className="sm:items-center">
          {readOnly ? (
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          ) : stepping ? (
            <>
              <Button type="button" variant="ghost" className="sm:mr-auto" disabled={busy} onClick={next}>Skip<ChevronRight aria-hidden="true" /></Button>
              <Button type="button" variant="outline" disabled={busy || !person0} onClick={() => void map(false)}>Map</Button>
              {!last && <Button type="button" disabled={busy || !person0} onClick={() => void map(true)}>Map and next<ChevronRight aria-hidden="true" /></Button>}
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy || !person0} onClick={() => void map(false)}>Map</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A mapped code: who it credits, and changing that person in one step (the same map_agent call, which replaces the
 * code's person). Unmap asks first (a loss), so this dialog closes and hands over to the shared confirm.
 */
export function MappedCodeDialog({ agent, members, readOnly, onSave, onUnmap, onClose }: {
  agent: MappedAgent;
  members: Member[];
  readOnly: boolean;
  onSave: (agent: MappedAgent, userId: string) => Promise<Outcome>;
  onUnmap: (agent: MappedAgent) => void;
  onClose: () => void;
}) {
  const [person, setPerson] = useState(agent.userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The person mapped today stays choosable even if they are no longer a writing member.
  const choices = members.some((m) => m.userId === agent.userId) ? members : [{ userId: agent.userId, name: agent.userName }, ...members];
  const changed = person !== agent.userId && choices.some((m) => m.userId === person);
  const save = async () => {
    setBusy(true);
    setError(null);
    const failed = await onSave(agent, person);
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="pr-8 font-mono">{agent.agentIdentifier}</DialogTitle>
          <DialogDescription>
            {agent.carrierName} · <Link href={policiesHref(agent.carrierId, agent.userId)} className="font-medium text-foreground underline underline-offset-2">{policiesLabel(agent.policies)}</Link> credit {agent.userName}.
          </DialogDescription>
        </DialogHeader>
        {readOnly ? (
          <div className="grid gap-1">
            <span className="text-label text-[var(--body)]">Person</span>
            <span className="text-sm text-foreground">{agent.userName}</span>
          </div>
        ) : (
          <div className="grid gap-3">
            <PersonField id="agent-code-mapped-person" value={person} members={choices} disabled={busy} hint="Choosing someone else moves the code to them in one step." onChange={(value) => { setPerson(value || agent.userId); setError(null); }} />
            <ErrorLine error={error} />
          </div>
        )}
        <DialogFooter className="sm:items-center">
          {readOnly ? (
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="text-[var(--error-ink)] sm:mr-auto" disabled={busy} onClick={() => onUnmap(agent)}>Unmap</Button>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={busy || !changed} onClick={() => void save()}>Save</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A code typed by hand, before the first file carries it: code, carrier, person, and the error line. */
export function AddCodeDialog({ carriers, members, onAdd, onClose }: {
  carriers: Carrier[];
  members: Member[];
  onAdd: (draft: { carrierId: string; code: string; userId: string }) => Promise<Outcome>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ carrierId: "", code: "", userId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(draft.carrierId && draft.code.trim() && draft.userId);
  const edit = (patch: Partial<typeof draft>) => { setDraft((now) => ({ ...now, ...patch })); setError(null); };
  const add = async () => {
    setBusy(true);
    setError(null);
    const failed = await onAdd({ ...draft, code: draft.code.trim() });
    setBusy(false);
    if (failed) setError(failed);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="pr-8">Add agent code</DialogTitle>
          <DialogDescription>A carrier&apos;s writing-agent code and the person it credits, before the first file carries it.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (ready && !busy) void add(); }}>
          <Field label="Agent code" htmlFor="agent-code-add-code" hint="As the carrier writes it">
            <input id="agent-code-add-code" className={cn(inputControl, "mt-1.5 font-mono")} spellCheck={false} autoComplete="off" disabled={busy} value={draft.code} onChange={(event) => edit({ code: event.target.value })} />
          </Field>
          <Field label="Carrier" htmlFor="agent-code-add-carrier">
            <SelectMenu id="agent-code-add-carrier" label="Carrier" className="mt-1.5 w-full" matchTriggerWidth searchPlaceholder="Search carriers" disabled={busy} value={draft.carrierId} options={[{ value: "", label: "Choose the carrier" }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]} onChange={(value) => edit({ carrierId: value })} />
          </Field>
          <PersonField id="agent-code-add-person" value={draft.userId} members={members} disabled={busy} onChange={(value) => edit({ userId: value })} />
          <ErrorLine error={error} />
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !ready}>Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
