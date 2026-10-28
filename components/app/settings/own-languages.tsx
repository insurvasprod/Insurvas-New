"use client";

/**
 * Settings › My profile › Languages I speak (owner, 2026-10-27): you set your own languages. It is
 * the same saved value a manager edits in Lead routing › Team; routing and Inbound offer callers who
 * speak a language you list to you first. English needs no entry to be offered English callers.
 */

import { useEffect, useState } from "react";

import { Callout, SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";
import { LANGUAGE_CODES, languageKey, languageName } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";
import { LeaveGuard } from "@/components/ui/leave-guard";

/** The languages callers most often ask for, in the words the database reads (languageKey). */
const COMMON = Object.values(LANGUAGE_CODES);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));

export function OwnLanguages() {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile/languages", { cache: "no-store" }).then(async (response) => {
      const body = (await response.json().catch(() => null)) as { languages?: string[]; available?: boolean; error?: string } | null;
      if (!live) return;
      if (!response.ok) { setError(body?.error ?? "Your languages could not be loaded."); return; }
      const keys = (body?.languages ?? []).map((value) => languageKey(value) ?? value);
      setSaved(keys);
      setPicked(keys);
      setAvailable(body?.available !== false);
    });
    return () => { live = false; };
  }, []);

  const toggle = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  const addOther = () => {
    const key = languageKey(other.trim());
    if (!key) return;
    if (!picked.includes(key)) setPicked((current) => [...current, key]);
    setOther("");
  };

  async function save() {
    setBusy(true);
    const response = await fetch("/api/app/profile/languages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languages: picked }) });
    const body = (await response.json().catch(() => null)) as { languages?: string[]; error?: string } | null;
    setBusy(false);
    if (!response.ok) { notify.block(body?.error ?? "Your languages could not be saved."); return; }
    const keys = (body?.languages ?? picked).map((value) => languageKey(value) ?? value);
    setSaved(keys);
    setPicked(keys);
    notify.done("Languages saved", { detail: keys.length ? `Callers who speak ${keys.map(languageName).join(", ")} are offered to you first.` : "No language listed." });
  }

  const extra = picked.filter((key) => !COMMON.includes(key));
  const dirty = saved !== null && !same(saved, picked);

  return (
    <SettingsCard title="Languages I speak" sub="Callers who speak a language you list are offered to you first. Your manager sees the same list in Lead routing.">
      <div id="profile-languages" className="flex flex-col gap-4">
        {error && <Callout tone="error" title={error} />}
        {!available && <Callout tone="warning" title="Languages need a database update that has not been applied yet." />}
        {saved === null && !error ? <p className="m-0 text-sm text-[var(--muted)]">Loading your languages…</p> : (
          <>
            <div role="group" aria-label="Languages I speak" className="flex flex-wrap gap-2">
              {[...COMMON, ...extra].map((key) => {
                const on = picked.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    disabled={!available || busy}
                    onClick={() => toggle(key)}
                    className={cn("inline-flex h-8 items-center rounded-full border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] text-[var(--body)] hover:border-[var(--accent-ink)]")}
                  >
                    {on ? "✓ " : ""}{languageName(key)}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="profile-language-other" className="sr-only">Another language</label>
              <input id="profile-language-other" className={cn(control, "mt-0 w-56")} placeholder="Another language" value={other} disabled={!available || busy} onChange={(event) => setOther(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOther(); } }} />
              <Button type="button" variant="outline" disabled={!available || busy || !other.trim()} onClick={addOther}>Add</Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <span className="text-sm text-[var(--muted)]">{picked.length ? `${picked.length} ${picked.length === 1 ? "language" : "languages"}: ${picked.map(languageName).join(", ")}` : "None listed: you are offered English-speaking callers first."}</span>
              <span className="flex gap-2">
                <LeaveGuard dirty={dirty} onDiscard={() => setPicked(saved ?? [])} what="your languages" />
        {dirty && <Button type="button" variant="outline" disabled={busy} onClick={() => setPicked(saved ?? [])}>Discard</Button>}
                <Button type="button" disabled={!dirty || busy || !available} onClick={() => void save()}>{busy ? "Saving…" : "Save languages"}</Button>
              </span>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
