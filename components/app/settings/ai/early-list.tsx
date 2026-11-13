"use client";

/**
 * Settings › AI assistant (round 8, option A): the opt-in confirm and the data-controls sheet (board A2).
 * Both only store the agency's choice in its Sales settings (aiEarlyList); no AI provider is called. What
 * nothing is wired to yet — the provider, the region, what the provider keeps, call transcripts — is shown
 * read only.
 */

import { useState } from "react";

import { SheetSection, ThreeWay } from "@/components/app/settings/sales-process/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch, inputControl } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";

import { FEATURES, KEEP_FOR, WHEN_READY, WHO, type EarlyList, type FeatureKey } from "./content";

export function EarlyListDialog({ open, start, joined, who, canEdit, saving, onCancel, onJoin, onLeave }: {
  open: boolean;
  /** The entry the dialog starts from (stored, or a fresh one). */
  start: EarlyList;
  joined: boolean;
  /** The person who'll get the email. */
  who: string;
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  onJoin: (features: FeatureKey[], whenReady: EarlyList["whenReady"]) => void;
  onLeave: () => void;
}) {
  const [features, setFeatures] = useState<FeatureKey[]>(start.features);
  const [whenReady, setWhenReady] = useState(start.whenReady);
  const flip = (key: FeatureKey) => setFeatures((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{joined ? "Your place on the early list" : "Join the early list?"}</DialogTitle>
          <DialogDescription>
            We&apos;ll email <b>{who || "you"}</b> the day the assistant is ready. Nothing is sent to any AI provider until you turn it on then.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!canEdit}>
          <legend className="mb-2 text-label text-[var(--body)]">Which features interest you?</legend>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((feature) => (
              <ToggleChip key={feature.key} selected={features.includes(feature.key)} disabled={!canEdit} onClick={() => flip(feature.key)}>{feature.title}</ToggleChip>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!canEdit}>
          <legend className="mb-2 text-label text-[var(--body)]">When it&apos;s ready</legend>
          {WHEN_READY.map((choice) => (
            <label key={choice.key} className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5", whenReady === choice.key ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)]")}>
              <input type="radio" name="ai-when-ready" className="mt-1" checked={whenReady === choice.key} onChange={() => setWhenReady(choice.key)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)]">{choice.title}</span>
                <span className="block text-xs text-[var(--muted)]">{choice.sub}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          {joined && canEdit && <Button type="button" variant="ghost" className="sm:mr-auto" disabled={saving} onClick={onLeave}>Leave the list</Button>}
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <span title={canEdit ? undefined : "Only an owner can change this."} className="inline-flex">
            <Button type="button" disabled={!canEdit || saving || features.length === 0} onClick={() => onJoin(features, whenReady)}>
              {joined ? "Save" : "Join the early list"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fixed({ value, tag }: { value: string; tag: string }) {
  return (
    <div className={cn(inputControl, "flex items-center justify-between gap-3 bg-[var(--surface-alt)] text-[var(--body)]")} aria-readonly="true">
      <span className="truncate">{value}</span>
      <span className="shrink-0 text-xs text-[var(--muted)]">{tag}</span>
    </div>
  );
}

const Help = ({ children }: { children: string }) => <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">{children}</p>;

export function DataControlsSheet({ start, canEdit, saving, onCancel, onSave }: {
  start: EarlyList["controls"];
  canEdit: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (controls: EarlyList["controls"]) => void;
}) {
  const [controls, setControls] = useState(start);
  const changed = JSON.stringify(controls) !== JSON.stringify(start);
  const set = <K extends keyof EarlyList["controls"]>(key: K, value: EarlyList["controls"][K]) => setControls((current) => ({ ...current, [key]: value }));

  return (
    <Sheet
      title="Data controls"
      subtitle="Saved now · applied when a provider is signed"
      onClose={onCancel}
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <span title={canEdit ? undefined : "Only an owner can change this."} className="inline-flex">
            <Button type="button" disabled={!canEdit || !changed || saving} onClick={() => onSave(controls)}>Save</Button>
          </span>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        <SheetSection title="Provider">
          <Fixed value="Not chosen yet" tag="chosen by Insurvas" />
          <Help>Chosen with Insurvas once its terms for health data are settled.</Help>
        </SheetSection>
        <SheetSection title="Where data is processed">
          <Fixed value="United States only" tag="required" />
          <Help>We&apos;ll only sign a provider that keeps health data in the US.</Help>
        </SheetSection>
        <SheetSection title="What the provider keeps">
          <Fixed value="Nothing · deleted after each answer" tag="required" />
          <Help>We only sign a provider that agrees to keep nothing and not learn from it.</Help>
        </SheetSection>
        <SheetSection title="Optional extras">
          <div className="flex items-center justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--ink)]">Send medication doses</span>
              <Help>Better carrier matches; names are sent either way</Help>
            </span>
            <Switch checked={controls.sendDoses} disabled={!canEdit} label="Send medication doses" onChange={(next) => set("sendDoses", next)} />
          </div>
          <div className="flex items-center justify-between gap-4" title="Call transcripts are never sent today.">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--ink)]">Use call transcripts</span>
              <Help>Never sent today. Call summaries would ask before using one.</Help>
            </span>
            <Switch checked={false} disabled label="Use call transcripts" />
          </div>
        </SheetSection>
        <SheetSection title="Keep what it writes">
          <ThreeWay label="Keep what it writes" size="md" value={controls.keepFor} options={KEEP_FOR} disabled={!canEdit} onChange={(key) => set("keepFor", key)} />
        </SheetSection>
        <SheetSection title="Who can use it">
          <ThreeWay label="Who can use it" size="md" value={controls.who} options={WHO} disabled={!canEdit} onChange={(key) => set("who", key)} />
        </SheetSection>
      </div>
    </Sheet>
  );
}
