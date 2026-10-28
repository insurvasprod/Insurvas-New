"use client";

import { useState } from "react";
import { Check, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Callout } from "@/components/app/settings/primitives";
import type { TemplateChange } from "@/lib/agentTemplates/draftChanges";
import { cn } from "@/lib/utils";

/** The four parts of Form settings, in the order the status line and the panel's tabs show them. */
export type SettingsTab = "who" | "parts" | "steps" | "versions";
export const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string; anchor: string }> = [
  { key: "who", label: "Who can apply", anchor: "form-who-can-apply" },
  { key: "parts", label: "Topics", anchor: "form-parts" },
  { key: "steps", label: "Lead steps", anchor: "form-lead-steps" },
  { key: "versions", label: "Versions & updates", anchor: "form-versions" },
];

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Form templates, layout C: one line that says whether partners see what is drawn below. Live, or N
 * changes (Undo all and Publish changes sit in the PublishBar below the form). The form's settings sit
 * here as chips, each saying its value, so nothing about the form hides in a card further down.
 */
export function StatusLine({ changes, seen, liveVersion, saveError, chips, onSettings }: {
  changes: TemplateChange[];
  seen: Record<string, number>;
  liveVersion: number;
  saveError: string;
  chips: ReadonlyArray<{ key: SettingsTab; label: string; value: string; tone?: "warn" | "info" }>;
  onSettings: (tab: SettingsTab) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const dirty = changes.length > 0;
  const word = changes.length === 1 ? "change" : "changes";
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="m-0 flex min-w-0 flex-[1_1_320px] items-start gap-2 text-sm leading-[1.5]">
          {dirty ? (
            <>
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning-ink)]" />
              <span className="text-[var(--body)]">
                <strong className="font-semibold text-[var(--warning-ink)]">{changes.length} {word} not published.</strong> Partners still see the old form until you publish.
              </span>
            </>
          ) : (
            <>
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success-ink)]" />
              <span className="text-[var(--body)]">
                <strong className="font-semibold text-[var(--success-ink)]">Live.</strong> Partners are using this form now (version {liveVersion}).
              </span>
            </>
          )}
        </p>
        {dirty && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button onClick={() => setListOpen((open) => !open)} type="button" variant="ghost" aria-expanded={listOpen} aria-controls="form-changes-list">
              {listOpen ? "Hide the changes" : `See the ${word}`}
            </Button>
          </div>
        )}
      </div>
      {dirty && listOpen && (
        <ol id="form-changes-list" className="m-0 flex list-none flex-col gap-1.5 border-t border-[var(--border)] p-0 pt-3">
          {changes.map((change) => (
            <li key={change.id} className="flex flex-wrap items-baseline gap-x-2 text-sm leading-[1.5]">
              <span className="font-semibold text-[var(--ink)]">{change.title}</span>
              {change.sub && <span className="text-[var(--muted)]">{change.sub}</span>}
              {seen[change.id] && <span className="ml-auto text-xs text-[var(--muted)] tabular-nums">{clock.format(seen[change.id])}</span>}
            </li>
          ))}
        </ol>
      )}
      {saveError && <Callout tone="error" title={`Nothing was published: ${saveError}`} />}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <span className="text-xs font-semibold text-[var(--muted)]">Form settings</span>
        {chips.map((chip) => (
          <button
            key={chip.key}
            onClick={() => onSettings(chip.key)}
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm leading-none transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
              chip.tone === "warn" ? "border-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]"
                : chip.tone === "info" ? "border-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]"
                : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)]",
            )}
          >
            <span className="font-semibold text-[var(--ink)]">{chip.label}</span>
            <span>{chip.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Undo all and Publish changes (the page's only green button), on a bar that stays at the bottom of
 * the window while there is anything to publish, so the way out is never scrolled away.
 */
export function PublishBar({ count, saving, onUndoAll, onPublish }: { count: number; saving: boolean; onUndoAll: () => void; onPublish: () => void }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--shadow-overlay)]">
      <span className="mr-auto text-sm font-semibold text-[var(--warning-ink)]">{count} {count === 1 ? "change" : "changes"} not published</span>
      <Button onClick={onUndoAll} type="button" variant="outline" disabled={saving}>Undo all</Button>
      <Button onClick={onPublish} type="button" disabled={saving}>{saving ? "Publishing…" : "Publish changes"}</Button>
      <InfoTip label="About publishing">Partners who already started a form finish it the old way. Everyone else gets the new form.</InfoTip>
    </div>
  );
}
