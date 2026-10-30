"use client";

/**
 * Settings › Disclosures › Try a case (board A, 2026-10-30). Answer the questions the live rules ask,
 * pick a state and a carrier, and see which documents an application like that would carry — through
 * lib/applications/disclosureRules.ts, the same reading the workspace uses. Nothing is saved.
 */

import { useMemo, useState } from "react";

import { Field, SettingsCard, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { tryCase, type LibraryDoc } from "@/lib/salesSettings/disclosureLibrary";
import type { DisclosureItem, DisclosureLibrary } from "@/lib/salesSettings/disclosures";
import { US_STATES } from "@/lib/signup/constants";
import { cn } from "@/lib/utils";

import { fieldKind, fieldLabel, ruleSentence } from "./disclosures-editor";

export function TryACase({ docs, library, onOpen }: { docs: LibraryDoc[]; library: DisclosureLibrary; onOpen: (item: DisclosureItem) => void }) {
  const [state, setState] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Every field a live rule reads, once, except the state (asked above).
  const fields = useMemo(() => {
    const keys = new Set<string>();
    for (const d of docs) for (const r of d.live?.rules ?? []) for (const c of r.clauses) if (c.field !== "addr.state") keys.add(c.field);
    return [...keys].map((key) => ({ key, label: fieldLabel(key, library), ...fieldKind(key, library) }));
  }, [docs, library]);

  const needed = useMemo(() => {
    const values: Record<string, unknown> = { "addr.state": state || null };
    const health: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = answers[f.key];
      if (raw === undefined || raw === "") continue;
      const value = f.boolean ? raw === "yes" : f.money ? Math.round(Number(raw.replace(/[$,\s]/g, "")) * 100) : raw;
      if (f.key.startsWith("health.")) health[f.key.slice(7)] = value;
      else values[f.key] = value;
    }
    return tryCase(docs, { state: state || null, carrierId: carrierId || null, values, answers: health });
  }, [docs, fields, answers, state, carrierId]);

  const reset = () => { setState(""); setCarrierId(""); setAnswers({}); };
  // Drafts the answers might also pick up, once published: said, not counted.
  const waiting = docs.filter((d) => d.draft);

  return (
    <SettingsCard title="Try a case" info="Answer like a client would. The documents an application with these answers would carry show on the right. It reads the live versions; a draft counts once it is published. Nothing is saved.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Field label="Client's state" htmlFor="try-state">
            <select id="try-state" className={control} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Not picked</option>
              {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
          <Field label="Carrier" htmlFor="try-carrier">
            <select id="try-carrier" className={control} value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">Not picked</option>
              {library.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {fields.map((f, i) => (
            <Field key={f.key} label={f.label} htmlFor={`try-f${i}`}>
              {f.boolean ? (
                <select id={`try-f${i}`} className={control} value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}>
                  <option value="">Not answered</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input id={`try-f${i}`} className={control} inputMode={f.money ? "decimal" : undefined} placeholder={f.money ? "$ amount" : "Answer"} value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <div><Button type="button" variant="ghost" onClick={reset}>Start over</Button></div>
        </div>

        <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
          <p className="m-0 text-card-title text-[var(--ink)]">{needed.length === 0 ? "No document would be required" : `This application would carry ${needed.length} ${needed.length === 1 ? "document" : "documents"}`}</p>
          {needed.map((d) => {
            const when = d.live!.rules.map((r) => ruleSentence(r.clauses, library)).join(" · or ");
            return (
              <div key={d.code} className={cn("m-glass-inset flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3")}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--ink)]">{d.live!.title}</div>
                  <div className="text-xs leading-[1.5] text-[var(--muted)]">v{d.live!.version}{d.live!.platform ? " (Insurvas)" : ""}{when ? ` · ${when}` : ""}</div>
                </div>
                <StatusChip tone="danger" dot={false}>Required</StatusChip>
                <Button type="button" variant="outline" size="sm" onClick={() => onOpen(d.live!)}>Open</Button>
              </div>
            );
          })}
          {needed.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">Change the answers on the left to see what a rule picks up.</p>}
          {waiting.map((d) => (
            <div key={`w-${d.code}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[var(--border-strong)] p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--ink)]">Draft v{d.draft!.version} of {d.draft!.title}</div>
                <div className="text-xs leading-[1.5] text-[var(--muted)]">Not counted until it is published</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(d.draft!)}>Review draft</Button>
            </div>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}
