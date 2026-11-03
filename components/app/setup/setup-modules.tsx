"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";

import { SetupStepList, type SetupStepRow } from "./setup-step-list";

export type SetupModuleGroup = { key: string; label: string; hint?: string; steps: SetupStepRow[]; optional?: boolean };

/**
 * The setup page's groups (owner, 2026-10-28: "simplify it and make it easier for people to set up
 * and start working"): Start working and Get paid right are open; Fine-tune later — optional settings
 * that work on their defaults — folds behind one control, so the page reads as the few steps that
 * matter instead of a wall of eighteen.
 */
export function SetupModules({ modules, nextKey }: { modules: SetupModuleGroup[]; nextKey: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const counted = modules.filter((module) => !module.optional);
  const folded = modules.filter((module) => module.optional);
  const foldedSteps = folded.reduce((sum, module) => sum + module.steps.length, 0);

  return (
    <>
      {counted.map((module) => (
        <TableCard key={module.key} title={module.label} description={module.hint}>
          <SetupStepList steps={module.steps} nextKey={nextKey} />
        </TableCard>
      ))}
      {expanded
        ? folded.map((module) => (
            <TableCard key={module.key} title={module.label} description={module.hint}>
              <SetupStepList steps={module.steps} nextKey={nextKey} />
            </TableCard>
          ))
        : null}
      {foldedSteps > 0 ? (
        <div>
          <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Hide optional settings" : `Show ${foldedSteps} optional setting${foldedSteps === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
