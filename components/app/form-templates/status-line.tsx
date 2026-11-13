"use client";

import { useState, type ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control } from "@/components/app/settings/primitives";
import { CHANGE_KIND_LABELS, type ChangeKind, type FormChange } from "@/lib/templates/formChanges";

/** The parts of the form's settings, in the outline's order; each anchor is a settings-search hit. */
export type SettingsTab = "who" | "parts" | "steps" | "hook" | "agents" | "versions";
export const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; label: string; anchor: string }> = [
  { key: "who", label: "Who can apply", anchor: "form-who-can-apply" },
  { key: "parts", label: "Pages & parts", anchor: "form-parts" },
  { key: "steps", label: "After sending", anchor: "form-lead-steps" },
  { key: "hook", label: "When a form is sent", anchor: "form-webhook" },
  { key: "agents", label: "For your agents only", anchor: "form-agents-only" },
  { key: "versions", label: "Versions & Insurvas updates", anchor: "form-versions" },
];

export type LineTone = "good" | "warning" | "danger" | "neutral";
const DOT: Record<LineTone, string> = { good: "bg-[var(--success)]", warning: "bg-[var(--warning)]", danger: "bg-[var(--error)]", neutral: "bg-[var(--muted)]" };
const INK: Record<LineTone, string> = { good: "text-[var(--body)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]", neutral: "text-[var(--body)]" };

/**
 * The status line under the title (settings foundation board): the page's state in one line, instead
 * of notice cards. "Live · version 8", "4 changes not published · draft saved to Insurvas just now",
 * "Couldn't save… Try again", "needs a database update".
 */
export function FormStatusLine({ tone, children, action }: { tone: LineTone; children: ReactNode; action?: ReactNode }) {
  return (
    <p role="status" className={cn("m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-[1.5]", INK[tone])}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span className="min-w-0">{children}</span>
      {action}
    </p>
  );
}

/** "needs a database update", the board's tag beside a part that waits on the migration. */
export function NeedsUpdate() {
  return <StatusChip tone="warning" dot={false}>needs a database update</StatusChip>;
}

export const KIND_TONE: Record<ChangeKind, "good" | "info" | "warning" | "danger"> = { added: "good", changed: "info", moved: "warning", removed: "danger" };

/** One change, its kind first: "Added · “How many cigarettes a day?” on page 2". */
export function ChangeLine({ change }: { change: FormChange }) {
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-[var(--border)] py-2.5 first:border-t-0">
      <span className="w-20 shrink-0"><StatusChip tone={KIND_TONE[change.kind]}>{CHANGE_KIND_LABELS[change.kind]}</StatusChip></span>
      <span className="min-w-0 text-sm leading-[1.5] text-[var(--ink)]">{change.title}{change.sub && <span className="text-[var(--muted)]"> · {change.sub}</span>}</span>
    </li>
  );
}

/**
 * Publish, asked once (board A9): what changes, who is on the old version, a note for the team, and
 * whether to tell partners. The page's one green button opens it; nothing else publishes.
 */
export function PublishDialog({ open, onOpenChange, nextVersion, changes, blockers, draftsOnLive, saving, onPublish }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextVersion: number;
  changes: FormChange[];
  blockers: string[];
  /** Partner forms already started on the live version. */
  draftsOnLive: number | null;
  saving: boolean;
  onPublish: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const live = nextVersion - 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-title-sm text-[var(--ink)]">Publish version {nextVersion}?</DialogTitle>
          <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">
            New leads use version {nextVersion} from now on. {draftsOnLive ? `The ${draftsOnLive} partner ${draftsOnLive === 1 ? "form" : "forms"} already started stay on version ${live} until they are sent.` : `Anyone who already started a form finishes it on version ${live}.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
          {changes.map((change) => <ChangeLine key={change.id} change={change} />)}
        </ul>
        {blockers.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {blockers.map((blocker) => <p key={blocker} className="m-0 flex gap-2 text-sm text-[var(--error-ink)]"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{blocker}</p>)}
          </div>
        )}
        {blockers.length === 0 && <p className="m-0 flex gap-2 text-sm text-[var(--ink)]"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success-ink)]" />Nothing blocks publishing.</p>}
        <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">
          Note for the team (optional)
          <input className={control} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What this version changes, in a few words" />
        </label>
        <DialogFooter className="gap-2">
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">Cancel</Button>
          <Button onClick={() => onPublish(note)} type="button" disabled={saving || blockers.length > 0}>{saving ? "Publishing…" : `Publish version ${nextVersion}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
