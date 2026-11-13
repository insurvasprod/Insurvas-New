"use client";

/**
 * Settings history · one change opened (board section 2): Before and After in plain words, where the
 * setting lives and what it does, who and when, the other values saved in the same save, and the
 * setting's earlier changes. The stored row (ids, keys, raw values) only behind "Show technical
 * details", with Copy. Drawn in the right sheet on Settings history, and in place inside My
 * profile's History sheet (a sheet never opens over a sheet).
 */

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  changeSentence, describeChange, roleWords, settingPurpose, wherePath, whoName,
  type DescribedChange, type IdNames,
} from "@/lib/settingsAudit/describe";
import type { SettingsAuditEntry } from "@/lib/settingsAudit/constants";
import { Avatar, ChangeWords, KindChip, clock, fullWhen, registryLabel, shortDate } from "./parts";

const SOURCE_WORDS: Record<SettingsAuditEntry["source"], string> = {
  ui: "from the web app",
  api: "through the API",
  system: "by Insurvas",
  migration: "recorded before this log",
};

/** "Changed by Dana Ruiz", "Added by", "Removed by", "Reset by". */
export function byLine(change: DescribedChange, who: string): string {
  const verb = change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : change.kind === "reset" ? "Reset" : "Changed";
  return `${verb} by ${who}`;
}

function Tile({ label, value, tone }: { label: string; value: string | null; tone: "before" | "after" }) {
  return (
    <div className={cn("min-w-0 rounded-xl px-3.5 py-3", tone === "after" ? "bg-[var(--primary-soft)] shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-[var(--surface-alt)] shadow-[inset_0_0_0_1px_var(--border)]")}>
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      <span className={cn("block font-semibold break-words text-[var(--ink)]", (value?.length ?? 0) > 40 ? "text-sm" : "text-base")}>{value ?? "Nothing"}</span>
    </div>
  );
}

function Facts({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode } | null> }) {
  return (
    <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-sm">
      {items.filter((item): item is { label: string; value: ReactNode } => Boolean(item)).map((item) => (
        <div key={item.label} className="contents">
          <dt className="pt-0.5 text-xs text-[var(--muted)]">{item.label}</dt>
          <dd className="m-0 min-w-0 break-words text-[var(--ink)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-4">
      <h3 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h3>
      {sub && <p className="m-0 mb-2 text-xs text-[var(--muted)]">{sub}</p>}
      {children}
    </section>
  );
}

type Earlier = { forId: string; entries: SettingsAuditEntry[] | null; names: IdNames; failed: boolean };

export function ChangeDetail({ entry, names, together, zone, mine }: {
  entry: SettingsAuditEntry;
  names: IdNames;
  /** The other entries written in the same save, newest first. */
  together: readonly SettingsAuditEntry[];
  zone: string;
  mine: boolean;
}) {
  const change = describeChange(entry, names);
  const who = whoName(entry);
  const role = roleWords(entry.actorRole);
  const purpose = settingPurpose(entry);
  const firstName = who.split(/\s+/)[0];

  // The setting's own history, read when the change opens (one small read: this setting only).
  const [earlier, setEarlier] = useState<Earlier>({ forId: "", entries: null, names: {}, failed: false });
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ section: entry.sectionKey, setting: entry.settingKey });
    if (mine) params.set("mine", "1");
    fetch(`/api/app/settings-audit?${params.toString()}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { entries: SettingsAuditEntry[]; names?: IdNames };
        if (live) setEarlier({ forId: entry.id, entries: body.entries, names: body.names ?? {}, failed: false });
      })
      .catch(() => { if (live) setEarlier({ forId: entry.id, entries: null, names: {}, failed: true }); });
    return () => { live = false; };
  }, [entry.id, entry.sectionKey, entry.settingKey, mine]);
  const earlierReady = earlier.forId === entry.id;
  const before = (earlier.entries ?? []).filter((other) => other.id !== entry.id && other.occurredAt <= entry.occurredAt).slice(0, 5);

  // Before / After tiles whenever there is a value to show; "archived", "uploaded" and the like read as what happened.
  const showPair = Boolean(change.before) || (Boolean(change.after) && (!change.phrase || change.phrase.startsWith("set to") || change.kind === "reset"));
  const technical = [
    `Change ${entry.id}`,
    `Section ${entry.sectionKey}`,
    `Setting ${entry.settingKey}`,
    `Stored before ${entry.oldValue ?? "(none)"}`,
    `Stored after ${entry.newValue ?? "(none)"}`,
    `Type ${entry.changeType}`,
    `Source ${entry.source}`,
    `At ${entry.occurredAt}`,
  ].join("\n");
  const copy = () => {
    const write = navigator.clipboard?.writeText(technical);
    if (!write) { notify.fail("Could not copy. Select the text and copy it yourself."); return; }
    void write.then(() => notify.done("Copied"), () => notify.fail("Could not copy. Select the text and copy it yourself."));
  };

  return (
    <div className="flex flex-col gap-4">
      {showPair ? (
        <div className={cn("grid gap-2.5", change.long ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch")}>
          <Tile label="Before" value={change.before} tone="before" />
          {!change.long && <span aria-hidden="true" className="self-center text-[var(--muted)]">→</span>}
          <Tile label="After" value={change.after ?? (change.kind === "reset" ? "The default" : null)} tone="after" />
        </div>
      ) : (
        <div className="rounded-xl bg-[var(--surface-alt)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
          <span className="block text-xs text-[var(--muted)]">What happened</span>
          <span className="block text-base font-semibold text-[var(--ink)]">{change.label} {change.phrase}</span>
        </div>
      )}

      <Facts
        items={[
          { label: "Where", value: wherePath(entry.sectionKey, registryLabel) },
          purpose ? { label: "What it does", value: purpose } : null,
          { label: "Who", value: <span className="inline-flex items-center gap-2"><Avatar name={who} />{who}{role ? <span className="text-[var(--muted)]"> · {role}</span> : null}</span> },
          { label: "When", value: fullWhen(entry.occurredAt, zone) },
          { label: "Change", value: <KindChip kind={change.kind} /> },
          entry.reason ? { label: "Why", value: entry.reason } : null,
        ]}
      />

      {together.length > 0 && (
        <Block title="Saved together" sub={`${firstName} changed these in the same save.`}>
          <ul className="m-0 list-none p-0">
            {together.map((other) => (
              <li key={other.id} className="flex items-center gap-2 border-b border-[var(--border)] py-2 text-sm text-[var(--body)] last:border-b-0">
                <span className="min-w-0 flex-1 truncate"><ChangeWords change={describeChange(other, names)} /></span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{clock(other.occurredAt, zone)}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Earlier changes to this setting">
        {!earlierReady ? (
          <div aria-hidden="true" className="flex flex-col gap-2 py-1">
            <span className="h-3 w-4/5 animate-pulse rounded bg-[var(--surface-alt)]" />
            <span className="h-3 w-3/5 animate-pulse rounded bg-[var(--surface-alt)]" />
          </div>
        ) : earlier.failed ? (
          <p className="m-0 text-sm text-[var(--muted)]">Couldn&rsquo;t read this setting&rsquo;s earlier changes.</p>
        ) : before.length === 0 ? (
          <p className="m-0 text-sm text-[var(--muted)]">This is the first recorded change to this setting.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {before.map((other) => {
              const words = describeChange(other, { ...names, ...earlier.names });
              const otherWho = whoName(other);
              return (
                <li key={other.id} className="flex items-center gap-2 border-b border-[var(--border)] py-2 text-sm text-[var(--body)] last:border-b-0">
                  <Avatar name={otherWho} />
                  <span className="min-w-0 flex-1 truncate" title={changeSentence(words)}>
                    {words.phrase ? sentenceCase(words.phrase) : <>{words.before ?? "Nothing"}<span aria-hidden="true" className="mx-1.5 text-[var(--muted)]">→</span>{words.after ?? "nothing"}</>}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{otherWho} · {shortDate(other.occurredAt, zone)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <details className="border-t border-[var(--border)] pt-4 [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none text-xs font-semibold text-[var(--accent-ink)] outline-none focus-visible:underline">Show technical details</summary>
        <p className="m-0 mt-2 mb-1.5 text-xs text-[var(--muted)]">Support may ask for this. Saved {SOURCE_WORDS[entry.source] ?? "in Settings"}.</p>
        <div className="flex items-start gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] py-2 pr-1 pl-3">
          <pre className="m-0 min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-[1.6] whitespace-pre-wrap break-all text-[var(--ink)]">{technical}</pre>
          <Button type="button" variant="ghost" size="sm" onClick={copy}>Copy</Button>
        </div>
      </details>
    </div>
  );
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
