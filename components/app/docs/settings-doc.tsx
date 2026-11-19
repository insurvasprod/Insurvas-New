"use client";

import { useState } from "react";

import { ToggleChip } from "@/components/ui/toggle-chip";
import type { SettingsDocPage } from "@/lib/docs/settingsDocs";
import { cn } from "@/lib/utils";

import { markSettingsWalked } from "./docs-menu";
import { ShotStepper, type ShotMove } from "./shot-stepper";

const card = "rounded-[16px] border border-[var(--border)] bg-[var(--color-card)]";

/**
 * One Settings page in Docs, R2 (owner 2026-11-17: "the same as for leads… with screenshots… what you need to do,
 * why you're doing it… simplify it"). It opens on the walk: each step on the real screen, lit, with what to do and
 * why. "Every setting" switches to the full reference: each part of the page (tab, step, sheet) as a chip, and
 * every setting on it with what it does, its default and who may change it. Both keep to the page's height.
 */
export function SettingsDoc({ page, moves, view }: { page: SettingsDocPage; moves: ShotMove[]; view: "walk" | "all" }) {
  const [at, setAt] = useState(0);
  const part = page.parts[at];
  // No bar over the picture (owner 2026-11-17: "remove that part"): the switch between the walk and every setting
  // is a link on the title line (?view=all), and who can open the page is in the title's (i).
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {view === "walk" && moves.length > 0 ? (
        // Reaching the last step ticks this page in the Docs menu (this browser).
        <ShotStepper moves={moves} onFinish={() => markSettingsWalked(page.slug)} />
      ) : (
        <>
          {page.parts.length > 1 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Parts of this page">
              {page.parts.map((item, index) => (
                <ToggleChip key={item.key} selected={index === at} onClick={() => setAt(index)} count={item.fields.length}>{item.title}</ToggleChip>
              ))}
            </div>
          ) : null}
          {part ? (
            <section aria-label={part.title} className={cn(card, "flex min-h-[280px] flex-1 flex-col overflow-hidden")}>
              <header className="flex flex-col gap-0.5 border-b border-[var(--border)] px-4 py-3">
                <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">{part.title}</h2>
                <p className="m-0 text-sm text-[var(--muted)]">{part.what}</p>
              </header>
              {part.fields.length === 0 ? (
                <p className="m-0 px-4 py-4 text-sm text-[var(--muted)]">Nothing to set here: this part only shows information.</p>
              ) : (
                <dl className="m-0 min-h-0 flex-1 overflow-y-auto">
                  {part.fields.map((field, index) => (
                    <div key={`${field.label}-${index}`} className="grid gap-x-6 gap-y-1 border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(160px,240px)_minmax(0,1fr)_minmax(120px,200px)]">
                      <dt className="text-sm font-semibold text-[var(--ink)]">{field.label}</dt>
                      <dd className="m-0 text-sm text-[var(--body)]">{field.what}{field.who ? <span className="text-[var(--muted)]"> · {field.who}</span> : null}</dd>
                      <dd className="m-0 text-xs text-[var(--muted)]">{field.default ? <>Default: <span className="text-[var(--ink)]">{field.default}</span></> : null}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
