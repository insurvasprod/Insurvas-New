"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";

import { SetupStepList, type SetupStepRow } from "./setup-step-list";

/** Steps shown before the rest fold away behind "Show N more steps". */
const LEADING_STEPS = 3;

export type SetupModuleGroup = { key: string; label: string; steps: SetupStepRow[] };

/**
 * The setup page's module cards, the later ones folded (redesign, 2026-10-24): eighteen steps on one
 * screen read as a wall, so the page leads with the modules that hold the first three steps and
 * offers the rest behind one control. Whole modules fold, never half of one, and the module holding
 * the next step always stays open, so "Start: …" in the header never points at something hidden.
 */
export function SetupModules({ modules, nextKey }: { modules: SetupModuleGroup[]; nextKey: string | null }) {
  const [expanded, setExpanded] = useState(false);

  const nextModule = modules.findIndex((module) => module.steps.some((step) => step.key === nextKey));
  let shownSteps = 0;
  let lead = 0;
  while (lead < modules.length && (shownSteps < LEADING_STEPS || lead <= nextModule)) {
    shownSteps += modules[lead].steps.length;
    lead += 1;
  }
  const folded = modules.slice(lead);
  const foldedSteps = folded.reduce((sum, module) => sum + module.steps.length, 0);
  const visible = expanded ? modules : modules.slice(0, lead);

  return (
    <>
      {visible.map((module) => (
        <TableCard key={module.key} title={module.label}>
          <SetupStepList steps={module.steps} nextKey={nextKey} />
        </TableCard>
      ))}
      {foldedSteps > 0 ? (
        <div>
          <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Show fewer steps" : `Show ${foldedSteps} more step${foldedSteps === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
