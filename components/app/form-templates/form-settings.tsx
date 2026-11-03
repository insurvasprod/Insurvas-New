"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { SectionLoading } from "@/components/ui/page-states";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout, Field, ToggleRow, control } from "@/components/app/settings/primitives";
import { SETTINGS_TABS, type SettingsTab } from "@/components/app/form-templates/status-line";
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
      <p className="m-0 text-sm text-[var(--body)]">Read from “{field.label}”. Checked when a partner sends a lead, and again when leads are imported.</p>
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
      <p className="m-0 text-sm text-[var(--body)]">Turn a topic off and partners skip its parts of the form for this product.</p>
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
function Versions({ current, published, name, onName, templates, selected, chosen, preview, applying, dirty, onSelect, onPreview, onApply }: VersionsProps) {
  const by = published ? `, published ${published.by ? `by ${published.by}, ` : ""}${when.format(new Date(published.at))}` : "";
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-sm text-[var(--ink)]">
        Version <strong className="font-semibold">{current.assignment.definition_version}</strong> is live: {current.template.fields.length} questions{by}.
      </p>
      <p className="m-0 text-xs text-[var(--body)]">Each publish makes a new version; partners who already started a form finish it on theirs.</p>
      <Field label="Name of this form" htmlFor="copy-name" hint="Only you and your team see it.">
        <input id="copy-name" className={control} maxLength={120} value={name} onChange={(event) => onName(event.target.value)} />
      </Field>
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
      <p className="m-0 text-sm text-[var(--body)]">Saved on every lead, but partners never see these. Your agents fill them in.</p>
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

/** One setting on a 48px row: its name and value closed, its controls open in place. */
function Row({ id: anchor, tab, label, value, tone, open, onToggle, children }: { /** The settings-search anchor, written out at each call. */ id: string; tab: SettingsTab; label: string; value: string; tone?: "warn" | "info"; open: boolean; onToggle: (tab: SettingsTab) => void; children: ReactNode }) {
  return (
    <section id={anchor} className="scroll-mt-24 border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => onToggle(tab)}
        aria-expanded={open}
        aria-controls={`${anchor}-body`}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-1 text-left hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring-color)]"
      >
        <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">{label}</span>
        <span className={`ml-auto min-w-0 truncate text-sm ${tone === "warn" ? "text-[var(--warning-ink)]" : tone === "info" ? "text-[var(--info-ink)]" : "text-[var(--body)]"}`}>{value}</span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-[var(--body)] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={`${anchor}-body`} className="px-1 pb-4">{children}</div>}
    </section>
  );
}

/**
 * Form templates, layout A: the side panel when no question is picked. The form's settings as rows
 * that say their value and open in place: who can apply, topics, lead steps, the version and the
 * questions kept for agents only. Beside the form from 1280px; a sheet below that.
 */
export function FormSettingsPanel({ open, onOpen, onClose, values, eligibility, onAges, form, fields, onGroup, versions, agents }: {
  /** The row that is open; null when every row is closed. */
  open: SettingsTab | null;
  onOpen: (tab: SettingsTab | null) => void;
  onClose: () => void;
  values: Record<SettingsTab, { text: string; tone?: "warn" | "info" }>;
  eligibility: TemplateField | null;
  onAges: (patch: { age_min?: number; age_max?: number }) => void;
  form: TemplateFormDefinition;
  fields: TemplateField[];
  onGroup: (group: TemplateSectionGroup, on: boolean) => void;
  versions: VersionsProps;
  agents: Parameters<typeof AgentsOnly>[0];
}) {
  const toggle = (tab: SettingsTab) => onOpen(open === tab ? null : tab);
  const rowProps = (tab: SettingsTab) => ({ tab, label: SETTINGS_TABS.find((entry) => entry.key === tab)!.label, value: values[tab].text, tone: values[tab].tone, open: open === tab, onToggle: toggle });
  return (
    <DetailPanel
      mode="split"
      splitFrom="xl"
      title="This form"
      status={<span className="text-sm text-[var(--body)]">{versions.name}</span>}
      onClose={onClose}
      closeLabel="Close the form’s settings"
      // Beside the form it is always there (board FtA), so the × shows only on the sheet below 1280px.
      className="xl:sticky xl:top-[calc(var(--top-bar-h)+1rem)] xl:max-h-[calc(100dvh-var(--top-bar-h)-2rem)] xl:self-start xl:[&>div:first-child>button:last-child]:hidden"
      bodyClassName="flex flex-col px-4 pt-1 pb-4"
    >
      <div className="border-b border-[var(--border)]">
        {/* Each id is a settings-search anchor (lib/settings/sections.ts, SETTINGS_TABS). */}
        <Row id="form-who-can-apply" {...rowProps("who")}><WhoCanApply field={eligibility} onAges={onAges} /></Row>
        <Row id="form-parts" {...rowProps("parts")}><PartsOfTheForm form={form} fields={fields} onChange={onGroup} /></Row>
        <Row id="form-lead-steps" {...rowProps("steps")}><LeadSteps /></Row>
        <Row id="form-versions" {...rowProps("versions")}><Versions {...versions} /></Row>
        <Row id="form-agents-only" {...rowProps("agents")}><AgentsOnly {...agents} /></Row>
      </div>
      <p className="m-0 mt-3 text-xs text-[var(--body)]">Click a question on the form to change it here.</p>
    </DetailPanel>
  );
}
