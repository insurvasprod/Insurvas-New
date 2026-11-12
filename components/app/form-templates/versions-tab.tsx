"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { SectionLoading } from "@/components/ui/page-states";
import type { TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import type { TemplateField, TemplateFormDefinition } from "@/lib/templates/constants";
import { formChanges, type FormChange } from "@/lib/templates/formChanges";
import { mergeFieldRules } from "@/lib/templates/fieldRulesStore";
import { cloneForm } from "@/components/app/form-templates/draft";
import { ChangeLine, FormStatusLine } from "@/components/app/form-templates/status-line";

type Version = { revision: number; name: string; created_at: string | null; created_by: string | null; fields: TemplateField[]; form_definition: TemplateFormDefinition; drafts_on_it: number };
const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

const asDraft = (version: Version, stages: TemplateDraft["stages"]): TemplateDraft => {
  const form = cloneForm(version.form_definition);
  return { name: version.name, fields: mergeFieldRules(version.fields.map((field) => ({ ...field, options: [...(field.options ?? [])], validation: { ...(field.validation ?? {}) } })), form), stages, form };
};

/**
 * The Versions tab (board A9): the draft and every published version, what each changed in plain
 * words, and Restore (a version back into the draft, to publish again). Publishing itself is the
 * title line's one green button.
 */
export function VersionsTab({ copyId, live, changes, saved, stages, latest, onUndoAll, onRestore, onReviewUpdate, onDraftsOnLive }: {
  copyId: string;
  live: number;
  changes: FormChange[];
  saved: TemplateDraft;
  stages: TemplateDraft["stages"];
  latest: { name: string; version: number } | null;
  onUndoAll: () => void;
  onRestore: (draft: TemplateDraft, revision: number) => void;
  onReviewUpdate: () => void;
  onDraftsOnLive: (count: number) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [failed, setFailed] = useState("");
  const [open, setOpen] = useState<number | "draft">(changes.length ? "draft" : live);

  const load = useCallback(async () => {
    setFailed("");
    const response = await fetch(`/api/app/templates/${copyId}/versions`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response?.ok) { setFailed(body?.error ?? "The versions didn’t load."); return; }
    const list = (body.versions ?? []) as Version[];
    setVersions(list);
    onDraftsOnLive(list.find((version) => version.revision === live)?.drafts_on_it ?? 0);
  }, [copyId, live, onDraftsOnLive]);
  // External state into the tab.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const picked = open === "draft" ? null : versions?.find((version) => version.revision === open) ?? null;
  const pickedChanges = useMemo(() => {
    if (!picked || !versions) return [];
    const before = versions.find((version) => version.revision === picked.revision - 1);
    if (!before) return [];
    return formChanges(asDraft(before, stages), asDraft(picked, stages));
  }, [picked, versions, stages]);

  const row = (selected: boolean) => cn("flex w-full items-center gap-3 border-t border-[var(--border)] px-4 py-2.5 text-left first:border-t-0 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]", selected ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <section aria-label="Versions" className="m-glass flex min-h-0 shrink-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] lg:w-[380px]">
        <div className="m-glass-head border-b border-[var(--border)] px-4 py-3"><h3 className="m-0 text-card-title text-[var(--ink)]">Versions</h3></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {changes.length > 0 && (
            <button type="button" className={row(open === "draft")} onClick={() => setOpen("draft")} aria-current={open === "draft" ? "true" : undefined}>
              <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--ink)]">Draft · version {live + 1}</strong><span className="block text-xs text-[var(--muted)]">{changes.length} {changes.length === 1 ? "change" : "changes"}</span></span>
              <StatusChip tone="info">Draft</StatusChip>
            </button>
          )}
          {versions === null && !failed && <div className="p-4"><SectionLoading rows={4} columns={1} label="Reading the versions" /></div>}
          {failed && <div className="p-4"><FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>}>{failed}</FormStatusLine></div>}
          {versions?.map((version) => (
            <button key={version.revision} type="button" className={row(open === version.revision)} onClick={() => setOpen(version.revision)} aria-current={open === version.revision ? "true" : undefined}>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-semibold text-[var(--ink)]">Version {version.revision}</strong>
                <span className="block truncate text-xs text-[var(--muted)]">{[version.created_at ? when.format(new Date(version.created_at)) : null, version.created_by, version.drafts_on_it ? `${version.drafts_on_it} partner ${version.drafts_on_it === 1 ? "form" : "forms"} on it` : null].filter(Boolean).join(" · ")}</span>
              </span>
              {version.revision === live && <StatusChip tone="good">Live</StatusChip>}
            </button>
          ))}
          {latest && (
            <div className={row(false)}>
              <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--ink)]">Insurvas update available</strong><span className="block truncate text-xs text-[var(--muted)]">{latest.name}, version {latest.version}</span></span>
              <Button type="button" variant="outline" size="sm" onClick={onReviewUpdate}>Review</Button>
            </div>
          )}
        </div>
      </section>
      <section aria-label="What changed" className="m-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--border)]">
        <div className="m-glass-head flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <h3 className="m-0 flex-1 text-card-title text-[var(--ink)]">{open === "draft" ? "What changed in the draft" : `What changed in version ${open}`}</h3>
          {open === "draft" && <Button type="button" variant="ghost" size="sm" onClick={onUndoAll}>Undo all</Button>}
          {picked && picked.revision !== live && <Button type="button" variant="outline" size="sm" onClick={() => onRestore(asDraft(picked, stages), picked.revision)}>Restore into the draft</Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2">
          {open === "draft" ? (
            changes.length ? <ul className="m-0 list-none p-0">{changes.map((change) => <ChangeLine key={change.id} change={change} />)}</ul> : <p className="m-0 py-2 text-sm text-[var(--muted)]">No changes since version {live}.</p>
          ) : picked ? (
            pickedChanges.length ? <ul className="m-0 list-none p-0">{pickedChanges.map((change) => <ChangeLine key={change.id} change={change} />)}</ul>
              : <p className="m-0 py-2 text-sm text-[var(--muted)]">{picked.revision === 1 ? "The first version: the form as it started." : "Nothing a person filling the form would notice."}</p>
          ) : <p className="m-0 py-2 text-sm text-[var(--muted)]">{saved.fields.length} questions on version {live}.</p>}
        </div>
      </section>
    </div>
  );
}
