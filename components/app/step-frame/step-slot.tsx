"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A place on a merged page's title line that a client step fills (Team and the pages it handed on, 2026-11-03):
 * the server frame draws `<StepSlotTarget id>` as its `actions` (or `lead`), and the step's client board puts the
 * buttons that hang on its own state there with `<StepSlot id>` — Producer payouts' Commit run, say — so they sit
 * on the title's line like every other step's, not in a row of their own above the table.
 */
export function StepSlotTarget({ id }: { id: string }) {
  return <div id={id} className="flex items-center gap-2 empty:hidden" />;
}

export function StepSlot({ id, children }: { id: string; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // The target is server-rendered in the header, so it exists once this has mounted.
  useEffect(() => { setTarget(document.getElementById(id)); }, [id]); // eslint-disable-line react-hooks/set-state-in-effect
  return target ? createPortal(children, target) : null;
}
