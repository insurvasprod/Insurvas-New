"use client";

import { InfoTip } from "@/components/ui/info-tip";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, Field, ToggleRow, control } from "@/components/app/settings/primitives";
import { PARTNER_TYPE_LABELS } from "@/lib/partners/constants";
import type { Pipeline } from "@/lib/pipelines/types";
import { TEMPLATE_SECTION_GROUPS, type TemplateField, type TemplateFormDefinition, type TemplateSectionGroup } from "@/lib/templates/constants";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionAvailabilityError, sectionsByGroup } from "@/lib/templates/sectionAvailability";
import { numberOrUndefined, type Available, type Current, type Preview, type Published } from "@/components/app/form-templates/draft";

/** "Who can apply": the youngest and oldest age, read from the form's date-of-birth question. */
function WhoCanApply({ field, onAges }: { field: TemplateField | null; onAges: (patch: { age_min?: number; age_max?: number }) => void }) {
  if (!field) return <Callout tone="info" title="This form has no date of birth, so anyone can apply.">Add a question that answers with “A date” for the date of birth to set an age range.</Callout>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
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
    <div className="flex flex-col gap-3">
      {TEMPLATE_SECTION_GROUPS.filter((group) => governed[group].length > 0).map((group) => (
        <ToggleRow
          key={group}
          id={`section-group-${group}`}
          title={TEMPLATE_SECTION_GROUP_LABELS[group]}
          help={`Its parts: ${governed[group].map((section) => section.label).join(", ")}`}
          checked={availability[group]}
          onChange={(on) => onChange(group, on)}
        />
      ))}
      {TEMPLATE_SECTION_GROUPS.every((group) => governed[group].length === 0) && <p className="m-0 text-sm text-[var(--body)]">No part of this form belongs to a topic, so there is nothing to switch off.</p>}
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
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-[var(--body)]">
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
                  <span className="ml-2 text-xs font-normal text-[var(--body)]">
                    {pipeline.partner_type ? `${PARTNER_TYPE_LABELS[pipeline.partner_type as keyof typeof PARTNER_TYPE_LABELS] ?? pipeline.partner_type} leads` : pipeline.is_default ? "Default, for every other lead" : "No partner type"}
                  </span>
                </p>
                <p className="m-0 mt-1 text-xs leading-[1.6] text-[var(--ink)]">{steps.map((stage) => stage.name).join(" → ") || "No steps yet"}</p>
              </li>
            );
          })}
          {data.pipelines.length === 0 && <li className="text-sm text-[var(--body)]">No pipelines yet.</li>}
        </ul>
      )}
      <a href="#pipelines" className="inline-flex h-9 items-center gap-1.5 self-start rounded-[8px] px-1 text-sm font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
        Change steps in Pipelines &amp; outcomes<ArrowRight aria-hidden="true" className="size-4" />
      </a>
    </div>
  );
}

const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export type VersionsProps = {
  current: Current;
  published: Published | null;
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
};

/** "Version": what is live and who put it there, the form's name, and Insurvas's own templates for this product. */
function Versions({ current, published, templates, selected, chosen, preview, applying, dirty, onSelect, onPreview, onApply }: VersionsProps) {
  const by = published ? `, published ${published.by ? `by ${published.by}, ` : ""}${when.format(new Date(published.at))}` : "";
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-sm text-[var(--ink)]">
        Version <strong className="font-semibold">{current.assignment.definition_version}</strong> is live: {current.template.fields.length} questions{by}.
      </p>
      <p className="m-0 text-xs text-[var(--body)]">Each publish makes a new version; partners who already started a form finish it on theirs.</p>
      {current.latest && (
        <Callout tone="info" title={`Insurvas has a newer version: ${current.latest.name}, version ${current.latest.version}.`}>
          Choose it below to see what it adds. Your own questions and steps stay.
        </Callout>
      )}
      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3.5">
        <span className="text-label font-semibold text-[var(--ink)]">Start from an Insurvas template</span>
        <div role="radiogroup" aria-label="Insurvas templates" className="flex flex-wrap gap-2">
          {templates.map((template) => {
            const value = `${template.id}:${template.version}`;
            return <ToggleChip key={value} role="radio" selected={selected === value} onClick={() => onSelect(selected === value ? "" : value)}><span>{template.name}, version {template.version}</span></ToggleChip>;
          })}
        </div>
        {templates.length === 0 && <p className="m-0 text-sm text-[var(--body)]">Insurvas has no other template for this product.</p>}
        <p className="m-0 text-xs text-[var(--body)]">Adding a template only adds what is missing. Nothing of yours is removed.</p>
        {chosen && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={onPreview} type="button" variant="outline">See what it adds</Button>
            <Button onClick={onApply} type="button" variant="outline" disabled={!preview || preview.alreadyApplied || applying || dirty}>{applying ? "Adding…" : "Add it to this form"}</Button>
          </div>
        )}
        {dirty && chosen && <p className="m-0 text-xs text-[var(--warning-ink)]">Publish or undo your changes first.</p>}
        {chosen && preview && (
          <div className="rounded-[10px] bg-[var(--surface-alt)] px-3.5 py-3 text-sm leading-[1.5] text-[var(--ink)]">
            <p className="m-0 font-semibold">{preview.alreadyApplied ? "Already added. Nothing new." : "It adds"}</p>
            {!preview.alreadyApplied && (
              <>
                <p className="m-0 mt-1">Questions: {preview.fieldsToAdd.length ? preview.fieldsToAdd.join(", ") : "none"}</p>
                <p className="m-0">Parts of the form: {preview.sectionsToAdd.length ? preview.sectionsToAdd.join(", ") : "none"}</p>
                <p className="m-0">Lead steps: {preview.stagesToAdd.length ? preview.stagesToAdd.join(", ") : "none"}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "For your agents only": lead fields that are not on the partner form. */
function AgentsOnly({ fields, picked, changed, onPick, onAdd }: { fields: TemplateField[]; picked: string | null; changed: ReadonlySet<string>; onPick: (fieldKey: string) => void; onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {fields.length ? (
        <div className="flex flex-wrap gap-2">
          {fields.map((field) => (
            <ToggleChip key={field.field_key} selected={picked === field.field_key} onClick={() => onPick(field.field_key)} count={changed.has(field.field_key) ? "changed" : undefined} countTone="warning">
              <span>{field.label || "Untitled question"}</span>
            </ToggleChip>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-[var(--body)]">None. Every question is on the partner form.</p>
      )}
      <Button onClick={onAdd} type="button" variant="outline" className="self-start"><Plus aria-hidden="true" />Add one</Button>
    </div>
  );
}

/** A setting that shows its controls, with its explanation behind an (i). */
function Section({ id, title, info, children }: { id: string; title: string; info?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-2 border-t border-[var(--border)] pt-3">
      <h3 className="m-0 flex items-center gap-1 text-sm font-semibold text-[var(--ink)]">{title}{info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}</h3>
      {children}
    </section>
  );
}

/**
 * Form settings, a section of its own (owner 2026-11-03): the form's name, who can apply, its topics and
 * the questions kept for agents only on the left; the version and the lead steps on the right.
 */
export function FormSettingsCard({ eligibility, onAges, form, fields, onGroup, versions, agents }: {
  eligibility: TemplateField | null;
  onAges: (patch: { age_min?: number; age_max?: number }) => void;
  form: TemplateFormDefinition;
  fields: TemplateField[];
  onGroup: (group: TemplateSectionGroup, on: boolean) => void;
  versions: VersionsProps;
  agents: Parameters<typeof AgentsOnly>[0];
}) {
  return (
    <section aria-label="Form settings" className="m-glass flex min-w-0 flex-col gap-5 rounded-[12px] border border-[var(--border)] p-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 sm:p-5">
      {/* Each id is a settings-search anchor (lib/settings/sections.ts, SETTINGS_TABS). */}
      <div className="flex min-w-0 flex-col gap-4">
        <Field label="Name of this form" htmlFor="copy-name" info="Only you and your team see it.">
          <input id="copy-name" className={control} maxLength={120} value={versions.name} onChange={(event) => versions.onName(event.target.value)} />
        </Field>
        <Section id="form-who-can-apply" title="Who can apply" info={eligibility ? `Read from “${eligibility.label}”. Checked when a partner sends a lead, and again when leads are imported.` : undefined}>
          <WhoCanApply field={eligibility} onAges={onAges} />
        </Section>
        <Section id="form-parts" title="Topics" info="Turn a topic off and partners skip its parts of the form for this product.">
          <PartsOfTheForm form={form} fields={fields} onChange={onGroup} />
        </Section>
        <Section id="form-agents-only" title="For your agents only" info="Saved on every lead, but partners never see these. Your agents fill them in.">
          <AgentsOnly {...agents} />
        </Section>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Section id="form-versions" title="Version"><Versions {...versions} /></Section>
        <Section id="form-lead-steps" title="Lead steps" info="Steps are edited in one place, Pipelines & outcomes."><LeadSteps /></Section>
      </div>
    </section>
  );
}
