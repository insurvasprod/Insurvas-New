"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { SectionLoading } from "@/components/ui/page-states";
import { Callout, Field, ToggleRow, control } from "@/components/app/settings/primitives";
import { SETTINGS_TABS, type SettingsTab } from "@/components/app/form-templates/status-line";
import { PARTNER_TYPE_LABELS } from "@/lib/partners/constants";
import type { Pipeline } from "@/lib/pipelines/types";
import { TEMPLATE_SECTION_GROUPS, type TemplateField, type TemplateFormDefinition, type TemplateSectionGroup } from "@/lib/templates/constants";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionAvailabilityError, sectionsByGroup } from "@/lib/templates/sectionAvailability";
import { numberOrUndefined, type Available, type Current, type Preview } from "@/components/app/form-templates/draft";

/** "Who can apply": the youngest and oldest age, read from the form's date-of-birth question. */
function WhoCanApply({ field, onAges }: { field: TemplateField | null; onAges: (patch: { age_min?: number; age_max?: number }) => void }) {
  if (!field) return <Callout tone="info" title="This form has no date of birth, so anyone can apply.">Add a question that answers with “A date” for the date of birth to set an age range.</Callout>;
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-sm text-[var(--muted)]">Checked when a partner sends a lead, and again when leads are imported. Read from “{field.label}”.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Youngest age" htmlFor="eligibility-min"><input id="eligibility-min" className={control} type="number" min={0} max={130} placeholder="No limit" value={field.validation?.age_min ?? ""} onChange={(event) => onAges({ age_min: numberOrUndefined(event.target.value) })} /></Field>
        <Field label="Oldest age" htmlFor="eligibility-max"><input id="eligibility-max" className={control} type="number" min={0} max={130} placeholder="No limit" value={field.validation?.age_max ?? ""} onChange={(event) => onAges({ age_max: numberOrUndefined(event.target.value) })} /></Field>
      </div>
    </div>
  );
}

/**
 * "Topics": switch a whole topic (Medical, Banking…) off for this product (LA-1.4-3). Only the topics
 * this form has parts for are listed; switching one with no parts would do nothing.
 */
function PartsOfTheForm({ form, fields, onChange }: { form: TemplateFormDefinition; fields: TemplateField[]; onChange: (group: TemplateSectionGroup, on: boolean) => void }) {
  const availability = sectionAvailability(form);
  const governed = sectionsByGroup(form);
  const problem = sectionAvailabilityError(form, fields);
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-sm text-[var(--muted)]">Turn a topic off and partners skip its parts of the form for this product.</p>
      {TEMPLATE_SECTION_GROUPS.filter((group) => governed[group].length > 0).map((group) => {
        const sections = governed[group];
        return (
          <ToggleRow
            key={group}
            id={`section-group-${group}`}
            title={TEMPLATE_SECTION_GROUP_LABELS[group]}
            help={`Its parts: ${sections.map((section) => section.label).join(", ")}`}
            checked={availability[group]}
            onChange={(on) => onChange(group, on)}
          />
        );
      })}
      {TEMPLATE_SECTION_GROUPS.every((group) => governed[group].length === 0) && <p className="m-0 text-sm text-[var(--muted)]">No part of this form belongs to a topic, so there is nothing to switch off.</p>}
      {problem && <Callout tone="error" title="This can’t be published yet">{problem}</Callout>}
    </div>
  );
}

type Pipelines = { state: "loading" } | { state: "failed" } | { state: "ready"; pipelines: Pipeline[] };

/**
 * "Lead steps": read-only (owner, 2026-10-27). Stages are edited in one place, Pipelines & outcomes;
 * this says which pipeline a lead from the form enters. The template's own stage list is still sent
 * with every publish, unchanged, so applying an Insurvas template keeps adding missing stages.
 */
function LeadSteps() {
  const [data, setData] = useState<Pipelines>({ state: "loading" });
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/app/pipelines", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (live) setData(response.ok && body ? { state: "ready", pipelines: (body.pipelines ?? []) as Pipeline[] } : { state: "failed" });
      }, () => { if (live) setData({ state: "failed" }); });
    return () => { live = false; };
  }, [reads]);

  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-sm text-[var(--muted)]">
        A lead from this form goes into the pipeline for its partner’s type, or your default pipeline when there is none. It starts at the first open step.
      </p>
      {data.state === "loading" && <SectionLoading label="Reading your pipelines" />}
      {data.state === "failed" && (
        <Callout tone="error" title="Your pipelines didn’t load.">
          <Button onClick={() => { setData({ state: "loading" }); setReads((n) => n + 1); }} type="button" variant="outline" className="mt-2">Try again</Button>
        </Callout>
      )}
      {data.state === "ready" && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.pipelines.map((pipeline) => {
            const steps = pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
            return (
              <li key={pipeline.id} className="rounded-[10px] border border-[var(--border)] px-3.5 py-3">
                <p className="m-0 text-sm font-semibold text-[var(--ink)]">
                  {pipeline.name}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {pipeline.partner_type ? `${PARTNER_TYPE_LABELS[pipeline.partner_type as keyof typeof PARTNER_TYPE_LABELS] ?? pipeline.partner_type} leads` : pipeline.is_default ? "Default, for every other lead" : "No partner type"}
                  </span>
                </p>
                <p className="m-0 mt-1 text-xs leading-[1.6] text-[var(--body)]">{steps.map((stage) => stage.name).join(" → ") || "No steps yet"}</p>
              </li>
            );
          })}
          {data.pipelines.length === 0 && <li className="text-sm text-[var(--muted)]">No pipelines yet.</li>}
        </ul>
      )}
      <a href="#pipelines" className="inline-flex h-9 items-center gap-1.5 self-start rounded-[8px] px-1 text-sm font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
        Change steps in Pipelines &amp; outcomes<ArrowRight aria-hidden="true" className="size-4" />
      </a>
    </div>
  );
}

/** "Versions & updates": the form's name, what is live, and Insurvas's own templates for this product. */
function Versions({ current, name, onName, templates, selected, chosen, preview, applying, dirty, onSelect, onPreview, onApply }: {
  current: Current;
  name: string;
  onName: (name: string) => void;
  templates: Available[];
  selected: string;
  chosen: Available | undefined;
  preview: Preview | null;
  applying: boolean;
  dirty: boolean;
  onSelect: (value: string) => void;
  onPreview: () => void;
  onApply: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-[var(--body)]">
        Live now: <strong className="font-semibold text-[var(--ink)]">version {current.assignment.definition_version}</strong>, {current.template.fields.length} questions. Each publish makes a new version; partners who already started a form finish it on theirs.
      </p>
      <Field label="Name of this form" htmlFor="copy-name" hint="Only you and your team see it.">
        <input id="copy-name" className={control} maxLength={120} value={name} onChange={(event) => onName(event.target.value)} />
      </Field>
      {current.latest && (
        <Callout tone="info" title={`Insurvas has a newer version: ${current.latest.name}, version ${current.latest.version}.`}>
          Choose it below to see what it adds. Your own questions and steps stay.
        </Callout>
      )}
      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
        <Field label="Start from an Insurvas template" htmlFor="platform-template" hint="Adding a template only adds what is missing. Nothing of yours is removed.">
          <select id="platform-template" className={control} value={selected} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Choose a template…</option>
            {templates.map((template) => <option key={`${template.id}-${template.version}`} value={`${template.id}:${template.version}`}>{template.name}, version {template.version}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onPreview} type="button" variant="outline" disabled={!chosen}>See what it adds</Button>
          <Button onClick={onApply} type="button" disabled={!chosen || !preview || applying || dirty}>{applying ? "Adding…" : "Add it to this form"}</Button>
        </div>
        {dirty && chosen && <p className="m-0 text-xs text-[var(--muted)]">Publish or undo your changes first.</p>}
        {chosen && preview && (
          <div className="rounded-[10px] bg-[var(--surface-alt)] px-3.5 py-3 text-sm leading-[1.5] text-[var(--body)]">
            <p className="m-0 font-semibold text-[var(--ink)]">{preview.alreadyApplied ? "Already added. Nothing new." : "It adds"}</p>
            <p className="m-0 mt-1">Questions: {preview.fieldsToAdd.length ? preview.fieldsToAdd.join(", ") : "none"}</p>
            <p className="m-0">Parts of the form: {preview.sectionsToAdd.length ? preview.sectionsToAdd.join(", ") : "none"}</p>
            <p className="m-0">Lead steps: {preview.stagesToAdd.length ? preview.stagesToAdd.join(", ") : "none"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Form templates, layout C: the form's settings, one panel, four tabs, opened from the status line. */
export function FormSettingsPanel({ tab, values, onTab, onClose, eligibility, onAges, form, fields, onGroup, versions }: {
  tab: SettingsTab;
  /** Each tab's current value, the same words as the status line's chips. */
  values: Record<SettingsTab, string>;
  onTab: (tab: SettingsTab) => void;
  onClose: () => void;
  eligibility: TemplateField | null;
  onAges: (patch: { age_min?: number; age_max?: number }) => void;
  form: TemplateFormDefinition;
  fields: TemplateField[];
  onGroup: (group: TemplateSectionGroup, on: boolean) => void;
  versions: Parameters<typeof Versions>[0];
}) {
  return (
    <DetailPanel mode="overlay" title="Form settings" subtitle="Changes here join your other changes until you publish." onClose={onClose}>
      {/* Status cards, as on My profile: each says its value before it is opened. */}
      <div role="tablist" aria-label="Form settings" className="grid grid-cols-2 gap-2">
        {SETTINGS_TABS.map((item) => {
          const on = item.key === tab;
          return (
            <button
              key={item.key}
              onClick={() => onTab(item.key)}
              id={`form-settings-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="form-settings-panel"
              className={cn(
                "flex min-h-[60px] flex-col items-start gap-0.5 rounded-[12px] bg-[var(--surface)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                on ? "border-2 border-[var(--ink)] px-[11px] py-[9px]" : "border border-[var(--border)] px-3 py-2.5 hover:border-[var(--border-strong)]",
              )}
            >
              <span className="text-sm font-bold text-[var(--ink)]">{item.label}</span>
              <span className="text-xs font-semibold text-[var(--muted)]">{values[item.key]}</span>
            </button>
          );
        })}
      </div>
      <div id="form-settings-panel" role="tabpanel" aria-labelledby={`form-settings-tab-${tab}`}>
        {/* Each tab's id is the settings search's anchor for it (lib/settings/sections.ts). */}
        {tab === "who" && <div id="form-who-can-apply" className="scroll-mt-24"><WhoCanApply field={eligibility} onAges={onAges} /></div>}
        {tab === "parts" && <div id="form-parts" className="scroll-mt-24"><PartsOfTheForm form={form} fields={fields} onChange={onGroup} /></div>}
        {tab === "steps" && <div id="form-lead-steps" className="scroll-mt-24"><LeadSteps /></div>}
        {tab === "versions" && <div id="form-versions" className="scroll-mt-24"><Versions {...versions} /></div>}
      </div>
    </DetailPanel>
  );
}
