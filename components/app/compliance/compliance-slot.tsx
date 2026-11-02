"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Puts a step's own controls into the Compliance frame's top row (2026-10-30, as Leads in does): its tabs
 * on the left (`lead`), level with the rail's top, and its own actions in the corner (`corner`) — the
 * page's one primary sits there. The frame renders the empty slots (compliance-flow.tsx); outside the
 * frame this renders nothing, so a screen that also stands alone keeps its controls with `useInComplianceFrame`.
 */
export function ComplianceSlot({ slot, children }: { slot: "lead" | "corner"; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // The slot is server-rendered beside this component, so it exists once we are mounted.
  useEffect(() => { setTarget(document.getElementById(`compliance-${slot}`)); }, [slot]); // eslint-disable-line react-hooks/set-state-in-effect
  return target ? createPortal(children, target) : null;
}

/** True inside the Compliance frame. */
export function useInComplianceFrame() {
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => { setInFrame(Boolean(document.getElementById("compliance-lead"))); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  return inFrame;
}
