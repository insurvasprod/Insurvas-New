"use client";

/**
 * Settings › Dialing cadence · History (round 8, board A). Every save of this scope is a version
 * (tenant_cadence_versions, since 20260925706200) with what it changed in words. View draws a version
 * on the timeline; Restore makes it the draft — nothing reaches the dialer until Save. Max calls is not
 * part of a version (its table keeps no history), so restoring a version keeps today's max calls.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { describeChanges, type Change } from "@/lib/cadence/changes";
import type { CadenceRow } from "@/lib/cadence/engine";
import { cn } from "@/lib/utils";

export type HistoryVersion = { id: string; savedAt: string; savedBy: string | null; source: "save" | "baseline"; rules: CadenceRow[] };
export type ViewedVersion = { label: string; rules: CadenceRow[] };

type Loaded = { ready: boolean; versions: HistoryVersion[] };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).replace(" AM", "am").replace(" PM", "pm");

const BULLET: Record<Change["kind"], string> = { add: "bg-[var(--success)]", remove: "bg-[var(--error)]", change: "bg-[var(--info)]" };

export function HistorySheet({
  campaignId,
  scopeName,
  describe,
  readOnly,
  onView,
  onRestore,
  onClose,
}: {
  campaignId: string;
  scopeName: string;
  /** "8 calls over 13 days" for a set of rules, from the same example the timeline draws. */
  describe: (rules: CadenceRow[]) => string;
  readOnly: boolean;
  onView: (version: ViewedVersion) => void;
  onRestore: (version: ViewedVersion) => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/app/cadence/history${campaignId ? `?campaignId=${campaignId}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load the history");
        return body as Loaded;
      })
      .then((body) => {
        if (!live) return;
        setError(null);
        setLoaded(body);
      })
      .catch((cause: unknown) => live && setError(cause instanceof Error ? cause.message : "Could not load the history"));
    return () => {
      live = false;
    };
  }, [campaignId, attempt]);

  // Oldest first for numbering; shown newest first.
  const versions = loaded?.versions ?? [];
  const oldestFirst = [...versions].reverse();
  const entries = oldestFirst.map((version, index) => {
    const number = oldestFirst.slice(0, index + 1).filter((entry) => entry.source === "save").length;
    const label = version.source === "baseline" ? "When history began" : `Version ${number}`;
    const before = index > 0 ? oldestFirst[index - 1].rules : null;
    return { version, label, changes: before ? describeChanges(before, version.rules) : [] };
  }).reverse();
  const chosen = entries.find((entry) => entry.version.id === picked) ?? null;

  const asViewed = (entry: (typeof entries)[number]): ViewedVersion => ({ label: entry.label, rules: entry.version.rules });
  const defaultEntry: ViewedVersion = { label: "Insurvas default", rules: [] };

  return (
    <Sheet
      title="Cadence history"
      subtitle={scopeName}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          {!readOnly && (
            <Button type="button" disabled={!chosen || chosen === entries[0]} onClick={() => chosen && onRestore(asViewed(chosen))}>
              {chosen && chosen !== entries[0] ? `Restore ${chosen.label.toLowerCase()}` : "Restore"}
            </Button>
          )}
        </div>
      }
    >
      {error ? (
        <ErrorState title="Couldn't load the history" detail="Your cadence and the dialer are not affected." action={<Button type="button" variant="outline" onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</Button>} />
      ) : !loaded ? (
        <SectionLoading rows={4} columns={1} label="Loading the cadence history" />
      ) : !loaded.ready ? (
        <EmptyState title="History needs a database update" hint="Once it is applied, every save is kept here as a version you can view and restore. Saving the cadence works either way." />
      ) : (
        <div className="flex flex-col gap-2">
          {entries.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">No saves yet. The first save starts the history.</p>}
          {entries.map((entry, index) => (
            <div
              key={entry.version.id}
              className={cn("flex gap-3 rounded-md border border-border bg-[var(--surface-tile)] p-3", picked === entry.version.id && "shadow-[0_0_0_2px_var(--ring-color)]")}
            >
              <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:underline" onClick={() => setPicked(entry.version.id)} aria-pressed={picked === entry.version.id}>
                <span className="flex items-center gap-2">
                  <b className="text-sm font-semibold text-[var(--ink)]">{entry.label}</b>
                  {index === 0 && <StatusChip tone="good">In force</StatusChip>}
                </span>
                <small className="block text-xs text-[var(--muted)]">
                  {entry.version.rules.length === 0 ? "The Insurvas default" : describe(entry.version.rules)}
                  {entry.version.savedBy ? ` · ${entry.version.savedBy}` : ""} · {when(entry.version.savedAt)}
                </small>
                {entry.changes.length > 0 && (
                  <ul className="m-0 mt-2 list-none p-0 text-xs text-[var(--body)]">
                    {entry.changes.slice(0, 6).map((change, at) => (
                      <li key={at} className="flex items-start gap-2 py-0.5">
                        <span aria-hidden="true" className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", BULLET[change.kind])} />
                        {change.text}
                      </li>
                    ))}
                    {entry.changes.length > 6 && <li className="py-0.5 pl-3.5 text-[var(--muted)]">and {entry.changes.length - 6} more</li>}
                  </ul>
                )}
              </button>
              <div className="flex shrink-0 items-start gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => onView(asViewed(entry))}>View</Button>
                {!readOnly && index > 0 && <Button type="button" variant="outline" size="sm" onClick={() => onRestore(asViewed(entry))}>Restore</Button>}
              </div>
            </div>
          ))}
          <div className="flex gap-3 rounded-md border border-border bg-[var(--surface-tile)] p-3">
            <div className="min-w-0 flex-1">
              <b className="text-sm font-semibold text-[var(--ink)]">Insurvas default</b>
              <small className="block text-xs text-[var(--muted)]">{describe([])}</small>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onView(defaultEntry)}>View</Button>
          </div>
          <p className="m-0 text-xs text-[var(--muted)]">Restore loads a version as your draft. Nothing changes for the dialer until you save. Max calls is not kept in versions, so it stays as it is.</p>
        </div>
      )}
    </Sheet>
  );
}
