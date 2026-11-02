"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TemplateChange } from "@/lib/agentTemplates/draftChanges";

/** The parts of the form's settings, in the side panel's order; each anchor is a settings-search hit. */
export type SettingsTab = "who" | "parts" | "steps" | "versions" | "agents";
export const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string; anchor: string }> = [
  { key: "who", label: "Who can apply", anchor: "form-who-can-apply" },
  { key: "parts", label: "Topics", anchor: "form-parts" },
  { key: "steps", label: "Lead steps", anchor: "form-lead-steps" },
  { key: "versions", label: "Version", anchor: "form-versions" },
  { key: "agents", label: "For your agents only", anchor: "form-agents-only" },
];

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

type PublishProps = {
  changes: TemplateChange[];
  seen: Record<string, number>;
  liveVersion: number;
  blockers: string[];
  saving: boolean;
  onUndoAll: () => void;
  onPublish: () => void;
};

/** "Live · version N" or "N changes not published", 36px like the controls beside it. */
function State({ changes, liveVersion }: Pick<PublishProps, "changes" | "liveVersion">) {
  const pending = changes.length > 0;
  return (
    <span role="status" className={`inline-flex h-9 items-center gap-2 text-sm font-semibold ${pending ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]"}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${pending ? "bg-[var(--warning)]" : "bg-[var(--success)]"}`} />
      {pending ? `${changes.length} ${changes.length === 1 ? "change" : "changes"} not published` : `Live · version ${liveVersion}`}
    </span>
  );
}

/**
 * Form templates, layout A: the page's state on the title's line. Live and its version, or N changes
 * with Review (every change with its time, and anything that blocks publishing), Undo all and
 * Publish version N, the page's one green button. Partners mid-form keep the version they started.
 * Below 1024px the buttons move to PublishBar at the foot of the screen; the state stays here.
 */
export function PublishControls(props: PublishProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <State changes={props.changes} liveVersion={props.liveVersion} />
      {props.changes.length > 0 && <div className="hidden items-center gap-2 lg:flex"><Actions {...props} /></div>}
    </div>
  );
}

/**
 * Below 1024px: Review, Undo all and Publish on a bar fixed to the foot of the screen (board FtP03).
 * Drawn on <body>: the settings frame is an @container, which would pin a fixed bar to the frame
 * (and a sticky one fell short of the screen's foot on a phone). The spacer keeps the last part of
 * the form clear of it. The side panel's sheet (z-40) sits over it while a question is open.
 */
export function PublishBar(props: PublishProps) {
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setReady(true), []);
  if (props.changes.length === 0) return null;
  return (
    <>
      <div aria-hidden="true" className="h-28 lg:hidden" />
      {ready && createPortal(
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--shadow-overlay)] lg:hidden">
          <span className="mr-auto"><State changes={props.changes} liveVersion={props.liveVersion} /></span>
          <Actions {...props} />
        </div>,
        document.body,
      )}
    </>
  );
}

function Actions({ changes, seen, liveVersion, blockers, saving, onUndoAll, onPublish }: PublishProps) {
  const word = changes.length === 1 ? "change" : "changes";
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline">Review {changes.length} {word}</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
          <p className="m-0 text-label font-semibold text-[var(--ink)]">Not published yet</p>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {changes.map((change) => (
              <li key={change.id} className="flex items-baseline gap-2 text-sm leading-[1.5]">
                <span className="min-w-0 flex-1"><strong className="font-semibold text-[var(--ink)]">{change.title}</strong>{change.sub && <span className="text-[var(--body)]"> {change.sub}</span>}</span>
                {seen[change.id] && <span className="text-xs text-[var(--body)] tabular-nums">{clock.format(seen[change.id])}</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5">
            {blockers.length === 0 ? (
              <p className="m-0 flex gap-2 text-sm text-[var(--ink)]"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success-ink)]" />Nothing blocks publishing. Partners who already started a form finish it on version {liveVersion}.</p>
            ) : blockers.map((blocker) => (
              <p key={blocker} className="m-0 flex gap-2 text-sm text-[var(--error-ink)]"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{blocker}</p>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Button onClick={onUndoAll} type="button" variant="outline" disabled={saving}>Undo all</Button>
      <Button onClick={onPublish} type="button" disabled={saving || blockers.length > 0} title={blockers[0]}>{saving ? "Publishing…" : `Publish version ${liveVersion + 1}`}</Button>
      <InfoTip label="About publishing">Partners who already started a form finish it the old way. Everyone else gets the new form.</InfoTip>
    </>
  );
}
