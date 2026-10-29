"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Puts a step's own controls into the Lead sources frame's top row (owner 2026-10-28): its tabs or
 * picker on the left (`lead`), level with the rail's top, and — for a step whose next move is its own
 * action (Import's "Continue to review", Review's "Import N leads") — that action in the corner where
 * every other step has "Continue to …" (`continue`). The frame renders the empty slots
 * (components/app/lead-sources/leads-in.tsx); outside the frame this renders nothing.
 */
export function LeadsInSlot({ slot, children }: { slot: "lead" | "continue"; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // The slot is server-rendered beside this component, so it exists once we are mounted.
  useEffect(() => { setTarget(document.getElementById(`leads-in-${slot}`)); }, [slot]); // eslint-disable-line react-hooks/set-state-in-effect
  return target ? createPortal(children, target) : null;
}

/** True inside the Lead sources frame, so a screen that also renders on its own can keep its own controls there. */
export function useInLeadsFrame() {
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => { setInFrame(Boolean(document.getElementById("leads-in-lead"))); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  return inFrame;
}
